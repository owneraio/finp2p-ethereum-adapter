import winston from "winston";
import { Contract, Interface, Log, Provider, id as keccakStr, zeroPadValue } from "ethers";
import { CustodyWallet, GasStation } from "../../../services/direct";
import { fundGasIfNeeded } from "../../../services/direct/helpers";
import { PullIntent, PullResult } from "./models";

const ERC20_PULL_ABI = [
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transferFrom(address from, address to, uint256 value) returns (bool)',
];
const APPROVAL_IFACE = new Interface(ERC20_PULL_ABI);
const APPROVAL_TOPIC = keccakStr("Approval(address,address,uint256)");
const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Polls `eth_getLogs` for ERC20 Approval(_, operator) events since the last seen block
 * on every contract that has an open intent, then runs transferFrom for the matching
 * owner. Switched from `contract.on(filter, ...)` to log polling because event
 * subscriptions are unreliable across the providers we run against (Fireblocks
 * BrowserProvider drops filters; public RPCs garbage-collect them) — log polling
 * works on any RPC and is stateless on the provider side.
 *
 * Intent matching: oldest-first per contract. A single open intent per contract avoids
 * ambiguity; multiple concurrent intents on the same contract are served FIFO.
 *
 * TODO: persist intents (DB), opportunistic pre-check when sender is known, reorg
 * handling (block-confirmation lag), retry on transient failures.
 */
export class ApprovalWatcher {

  private readonly intents = new Map<string, PullIntent>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly lastSeen = new Map<string, number>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly operatorAddress: string,
    private readonly operatorWallet: CustodyWallet,
    private readonly provider: Provider,
    private readonly logger: winston.Logger,
    private readonly gasStation: GasStation | undefined,
    private readonly onPullCompleted?: (result: PullResult) => Promise<void>,
    private readonly pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ) {}

  async addIntent(intent: PullIntent): Promise<void> {
    this.intents.set(intent.correlationId, intent);
    await this.ensurePolling(intent.contractAddress);
  }

  private async ensurePolling(contractAddress: string): Promise<void> {
    const key = contractAddress.toLowerCase();
    if (this.timers.has(key)) return;
    // Start from the current block — we don't backfill past approvals.
    this.lastSeen.set(key, await this.provider.getBlockNumber());
    const timer = setInterval(() => {
      this.pollOnce(contractAddress).catch((e) =>
        this.logger.error(`Pull-deposit: poll failed for ${contractAddress}: ${e?.message ?? e}`),
      );
    }, this.pollIntervalMs);
    this.timers.set(key, timer);
    this.logger.info(`Pull-deposit: polling Approval(_, ${this.operatorAddress}) on ${contractAddress} every ${this.pollIntervalMs}ms`);
  }

  private stopPolling(contractAddress: string): void {
    const key = contractAddress.toLowerCase();
    const t = this.timers.get(key);
    if (t) clearInterval(t);
    this.timers.delete(key);
    this.lastSeen.delete(key);
  }

  private async pollOnce(contractAddress: string): Promise<void> {
    const key = contractAddress.toLowerCase();
    if (this.inFlight.has(key)) return;
    if (!this.hasOpenIntentFor(contractAddress)) {
      this.stopPolling(contractAddress);
      return;
    }
    const fromBlock = (this.lastSeen.get(key) ?? 0) + 1;
    const latest = await this.provider.getBlockNumber();
    if (latest < fromBlock) return;

    const logs: Log[] = await this.provider.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock: latest,
      topics: [APPROVAL_TOPIC, null, zeroPadValue(this.operatorAddress, 32)],
    });
    if (logs.length === 0) {
      this.lastSeen.set(key, latest);
      return;
    }

    this.inFlight.add(key);
    try {
      for (const log of logs) {
        const parsed = APPROVAL_IFACE.parseLog({ topics: [...log.topics], data: log.data });
        if (!parsed) continue;
        const owner: string = parsed.args[0];
        const value: bigint = parsed.args[2];
        await this.handleApproval(contractAddress, owner, value);
      }
      // Only advance the cursor after the batch processed cleanly. If any
      // handleApproval threw (e.g. transferFrom failed because operator gas
      // funding hasn't settled), leave lastSeen so the next poll retries.
      this.lastSeen.set(key, latest);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private hasOpenIntentFor(contractAddress: string): boolean {
    const lower = contractAddress.toLowerCase();
    for (const intent of this.intents.values()) {
      if (intent.contractAddress.toLowerCase() === lower) return true;
    }
    return false;
  }

  private findMatchingIntent(contractAddress: string): PullIntent | undefined {
    let match: PullIntent | undefined;
    for (const intent of this.intents.values()) {
      if (intent.contractAddress.toLowerCase() !== contractAddress.toLowerCase()) continue;
      if (!match || intent.createdAt < match.createdAt) match = intent;
    }
    return match;
  }

  private async handleApproval(contractAddress: string, owner: string, eventValue: bigint): Promise<void> {
    const intent = this.findMatchingIntent(contractAddress);
    if (!intent) {
      this.logger.info(`Pull-deposit: no open intent for contract ${contractAddress}, ignoring approval from ${owner} (${eventValue})`);
      return;
    }

    const readContract = new Contract(contractAddress, ERC20_PULL_ABI, this.provider);
    const currentAllowance: bigint = await readContract.allowance(owner, this.operatorAddress);
    const desired: bigint = intent.expectedAmount ? BigInt(intent.expectedAmount) : eventValue;
    if (currentAllowance < desired) {
      this.logger.info(`Pull-deposit: allowance ${currentAllowance} < desired ${desired} for owner=${owner}, waiting for more`);
      return;
    }

    this.logger.info(
      `Pull-deposit: executing transferFrom(${owner}, ${intent.destinationAddress}, ${desired}) for intent ${intent.correlationId}`,
    );
    // Top up the operator with gas before transferFrom — Fireblocks rejects with
    // INSUFFICIENT_FUNDS_FOR_FEE if the operator wallet drifts low.
    await fundGasIfNeeded(this.logger, this.gasStation, this.operatorWallet);
    const writeContract = new Contract(contractAddress, ERC20_PULL_ABI, this.operatorWallet.signer);
    const tx = await writeContract.transferFrom(owner, intent.destinationAddress, desired);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      this.logger.error(`Pull-deposit: transferFrom failed for intent ${intent.correlationId}`);
      return;
    }

    this.intents.delete(intent.correlationId);
    if (!this.hasOpenIntentFor(contractAddress)) this.stopPolling(contractAddress);
    this.logger.info(`Pull-deposit: pulled ${desired} from ${owner} → ${intent.destinationAddress} (tx ${receipt.hash})`);

    if (this.onPullCompleted) {
      await this.onPullCompleted({ intent, owner, txHash: receipt.hash, amount: desired.toString() });
    }
  }
}
