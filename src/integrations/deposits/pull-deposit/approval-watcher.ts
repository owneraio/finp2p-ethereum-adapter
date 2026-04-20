import winston from "winston";
import { Contract, Provider, Signer } from "ethers";

const ERC20_PULL_ABI = [
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transferFrom(address from, address to, uint256 value) returns (bool)',
];

export interface PullIntent {
  correlationId: string;
  finId: string;
  contractAddress: string;
  destinationAddress: string;
  expectedAmount?: string;
  createdAt: number;
}

export interface PullResult {
  intent: PullIntent;
  owner: string;
  txHash: string;
  amount: string;
}

/**
 * Listens for ERC20 Approval events where the spender is this watcher's operator address.
 * On a matching approval for an open intent's contract:
 *   1. Verify current on-chain allowance (race-safe re-read).
 *   2. Execute transferFrom(owner, intent.destinationAddress, amount) as the operator.
 *
 * Intent matching is oldest-first per contract. A single open intent per contract
 * avoids ambiguity; multiple concurrent intents on the same contract are served FIFO.
 *
 * TODO: persist intents (DB), support opportunistic pre-check when sender address is known,
 * handle reorgs, retry on transient failures, dedupe watchers on shutdown.
 */
export class ApprovalWatcher {

  private readonly contracts = new Map<string, Contract>(); // contractAddress -> read-only Contract with filter subscription
  private readonly intents = new Map<string, PullIntent>(); // correlationId -> intent

  constructor(
    private readonly operatorAddress: string,
    private readonly operatorSigner: Signer,
    private readonly provider: Provider,
    private readonly logger: winston.Logger,
    private readonly onPullCompleted?: (result: PullResult) => Promise<void>,
  ) {}

  addIntent(intent: PullIntent): void {
    this.intents.set(intent.correlationId, intent);
    this.ensureWatching(intent.contractAddress);
  }

  private ensureWatching(contractAddress: string): void {
    const key = contractAddress.toLowerCase();
    if (this.contracts.has(key)) return;
    const contract = new Contract(contractAddress, ERC20_PULL_ABI, this.provider);
    const filter = contract.filters.Approval(null, this.operatorAddress);
    contract.on(filter, (owner: string, _spender: string, value: bigint) => {
      this.handleApproval(contractAddress, owner, value).catch(e =>
        this.logger.error(`Pull-deposit: approval handler failed: ${e?.message ?? e}`),
      );
    });
    this.contracts.set(key, contract);
    this.logger.info(`Pull-deposit: watching Approval on ${contractAddress} spender=${this.operatorAddress}`);
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

    const readContract = this.contracts.get(contractAddress.toLowerCase())!;
    const currentAllowance: bigint = await readContract.allowance(owner, this.operatorAddress);
    const desired: bigint = intent.expectedAmount ? BigInt(intent.expectedAmount) : eventValue;
    if (currentAllowance < desired) {
      this.logger.info(`Pull-deposit: allowance ${currentAllowance} < desired ${desired} for owner=${owner}, waiting for more`);
      return;
    }

    this.logger.info(
      `Pull-deposit: executing transferFrom(${owner}, ${intent.destinationAddress}, ${desired}) for intent ${intent.correlationId}`,
    );
    const writeContract = new Contract(contractAddress, ERC20_PULL_ABI, this.operatorSigner);
    const tx = await writeContract.transferFrom(owner, intent.destinationAddress, desired);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      this.logger.error(`Pull-deposit: transferFrom failed for intent ${intent.correlationId}`);
      return;
    }

    this.intents.delete(intent.correlationId);
    this.logger.info(`Pull-deposit: pulled ${desired} from ${owner} → ${intent.destinationAddress} (tx ${receipt.hash})`);

    if (this.onPullCompleted) {
      await this.onPullCompleted({ intent, owner, txHash: receipt.hash, amount: desired.toString() });
    }
  }
}
