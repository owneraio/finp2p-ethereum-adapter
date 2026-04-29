import winston from "winston";
import { Interface, Log, Provider, id as keccakStr, zeroPadValue } from "ethers";
import { ERC20Contract } from "@owneraio/finp2p-contracts";
import { CustodyWallet, GasStation } from "../../../services/direct";
import { fundGasIfNeeded } from "../../../services/direct/helpers";
import { PullDeposit, PullResult } from "./models";

const APPROVAL_IFACE = new Interface([
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
]);
const APPROVAL_TOPIC = keccakStr("Approval(address,address,uint256)");
const DEFAULT_POLL_INTERVAL_MS = 60000;

/**
 * Polls `eth_getLogs` for ERC20 Approval(_, operator) events since the last seen block
 * on every contract that has an open deposit, then runs transferFrom for the matching
 * owner. Switched from `contract.on(filter, ...)` to log polling because event
 * subscriptions are unreliable across the providers we run against (Fireblocks
 * BrowserProvider drops filters; public RPCs garbage-collect them) — log polling
 * works on any RPC and is stateless on the provider side.
 *
 * Concurrency: pull-deposit currently lacks a declared-sender mechanism (the deposit
 * API only carries finId, not the depositor's external EVM address), so we cannot tell
 * which investor a given Approval event belongs to. To keep correctness, addDeposit()
 * enforces one open deposit per contract — a second deposit on the same contract while
 * the first is still in flight is rejected. This serializes throughput per contract but
 * eliminates the cross-investor mis-credit risk that FIFO matching would create.
 *
 * TODO: persist deposits (DB), declared-sender support (match by owner), reorg
 * handling (block-confirmation lag), retry on transient failures.
 */
export class ApprovalWatcher {

  private readonly deposits = new Map<string, PullDeposit>();
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

  async addDeposit(deposit: PullDeposit): Promise<void> {
    if (this.hasOpenDepositFor(deposit.contractAddress)) {
      throw new Error(
        `Pull-deposit: another deposit on contract ${deposit.contractAddress} is already in flight; ` +
        `concurrent pull-deposits on the same token are not yet supported (no declared-sender API).`,
      );
    }
    this.deposits.set(deposit.correlationId, deposit);
    await this.ensurePolling(deposit.contractAddress);
  }

  private async ensurePolling(contractAddress: string): Promise<void> {
    const key = contractAddress.toLowerCase();
    if (this.timers.has(key)) return;
    // Seed one block before "now" so the first scan covers the current block —
    // an Approval mined in the same block as deposit creation would otherwise be
    // skipped forever (fromBlock = lastSeen + 1 would land at currentBlock + 1).
    const currentBlock = await this.provider.getBlockNumber();
    this.lastSeen.set(key, Math.max(0, currentBlock - 1));
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
    if (!this.hasOpenDepositFor(contractAddress)) {
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

  private hasOpenDepositFor(contractAddress: string): boolean {
    const lower = contractAddress.toLowerCase();
    for (const deposit of this.deposits.values()) {
      if (deposit.contractAddress.toLowerCase() === lower) return true;
    }
    return false;
  }

  private findMatchingDeposit(contractAddress: string): PullDeposit | undefined {
    let match: PullDeposit | undefined;
    for (const deposit of this.deposits.values()) {
      if (deposit.contractAddress.toLowerCase() !== contractAddress.toLowerCase()) continue;
      if (!match || deposit.createdAt < match.createdAt) match = deposit;
    }
    return match;
  }

  private async handleApproval(contractAddress: string, owner: string, eventValue: bigint): Promise<void> {
    const deposit = this.findMatchingDeposit(contractAddress);
    if (!deposit) {
      this.logger.info(`Pull-deposit: no open deposit for contract ${contractAddress}, ignoring approval from ${owner} (${eventValue})`);
      return;
    }

    const erc20 = new ERC20Contract(this.provider, this.operatorWallet.signer, contractAddress, this.logger);
    const currentAllowance: bigint = await erc20.allowance(owner, this.operatorAddress);
    const desired: bigint = deposit.expectedAmount ? BigInt(deposit.expectedAmount) : eventValue;
    if (currentAllowance < desired) {
      this.logger.info(`Pull-deposit: allowance ${currentAllowance} < desired ${desired} for owner=${owner}, waiting for more`);
      return;
    }

    this.logger.info(
      `Pull-deposit: executing transferFrom(${owner}, ${deposit.destinationAddress}, ${desired}) for deposit ${deposit.correlationId}`,
    );
    // Top up the operator with gas before transferFrom — Fireblocks rejects with
    // INSUFFICIENT_FUNDS_FOR_FEE if the operator wallet drifts low.
    await fundGasIfNeeded(this.logger, this.gasStation, this.operatorWallet);
    const tx = await erc20.transferFrom(owner, deposit.destinationAddress, desired);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      this.logger.error(`Pull-deposit: transferFrom failed for deposit ${deposit.correlationId}`);
      return;
    }

    this.deposits.delete(deposit.correlationId);
    if (!this.hasOpenDepositFor(contractAddress)) this.stopPolling(contractAddress);
    this.logger.info(`Pull-deposit: pulled ${desired} from ${owner} → ${deposit.destinationAddress} (tx ${receipt.hash})`);

    if (this.onPullCompleted) {
      await this.onPullCompleted({ deposit, owner, txHash: receipt.hash, amount: desired.toString() });
    }
  }
}
