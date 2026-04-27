import winston from "winston";
import { Contract, Provider } from "ethers";
import { CustodyWallet, GasStation } from "../../../services/direct";
import { fundGasIfNeeded } from "../../../services/direct/helpers";

const ERC20_TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
];

export interface OtaIntent {
  correlationId: string;
  finId: string;
  assetId: string;
  contractAddress: string;
  ephemeralAddress: string;
  custodyAccountId: string;
  ephemeralWallet: CustodyWallet;
  sweepTarget: string;
  expectedAmount?: string;
  createdAt: number;
}

export interface OtaResult {
  intent: OtaIntent;
  sender: string;
  receivedAmount: string;
  inboundTxHash: string;
  sweepTxHash: string | undefined;
}

/**
 * Watches ERC20 Transfer events for incoming transfers to per-intent ephemeral addresses
 * (custody-managed wallets, one per deposit). Subscribes per-contract and matches the
 * inbound transfer's `to` field against open intents.
 *
 * On match:
 *   1. Re-read on-chain balanceOf(ephemeral) — race-safe; may capture later top-ups.
 *   2. Fund the ephemeral with gas via the operator's gas-station (custody-managed).
 *   3. Sweep balance from ephemeral → sweepTarget, signed by the custody-held key.
 *   4. Notify caller via onTransferDetected.
 *
 * If sweep fails (e.g. no gas-station configured), the inbound is still reported with
 * sweepTxHash=undefined; funds remain at the ephemeral until manually swept.
 *
 * TODO: persist intents (DB), reorg handling, retry on transient failures, expire stale intents.
 */
export class TransferWatcher {

  private readonly contracts = new Map<string, Contract>();
  private readonly intents = new Map<string, OtaIntent>();

  constructor(
    private readonly provider: Provider,
    private readonly logger: winston.Logger,
    private readonly gasStation: GasStation | undefined,
    private readonly onTransferDetected?: (result: OtaResult) => Promise<void>,
  ) {}

  addIntent(intent: OtaIntent): void {
    this.intents.set(intent.correlationId, intent);
    this.ensureWatching(intent.contractAddress);
  }

  private ensureWatching(contractAddress: string): void {
    const key = contractAddress.toLowerCase();
    if (this.contracts.has(key)) return;
    const contract = new Contract(contractAddress, ERC20_TRANSFER_ABI, this.provider);
    contract.on(contract.filters.Transfer(), (from: string, to: string, value: bigint) => {
      this.handleTransfer(contractAddress, from, to, value).catch(e =>
        this.logger.error(`OTA-deposit: transfer handler failed: ${e?.message ?? e}`),
      );
    });
    this.contracts.set(key, contract);
    this.logger.info(`OTA-deposit: watching Transfer events on ${contractAddress}`);
  }

  private findMatchingIntent(contractAddress: string, recipient: string): OtaIntent | undefined {
    const recipientLower = recipient.toLowerCase();
    for (const intent of this.intents.values()) {
      if (intent.contractAddress.toLowerCase() !== contractAddress.toLowerCase()) continue;
      if (intent.ephemeralAddress.toLowerCase() === recipientLower) return intent;
    }
    return undefined;
  }

  private async handleTransfer(contractAddress: string, from: string, to: string, eventValue: bigint): Promise<void> {
    const intent = this.findMatchingIntent(contractAddress, to);
    if (!intent) return;

    this.logger.info(
      `OTA-deposit: detected Transfer(${from} → ${to}, ${eventValue}) for intent ${intent.correlationId}`,
    );

    const readContract = this.contracts.get(contractAddress.toLowerCase())!;
    const balance: bigint = await readContract.balanceOf(intent.ephemeralAddress);
    if (intent.expectedAmount && balance < BigInt(intent.expectedAmount)) {
      this.logger.info(
        `OTA-deposit: balance ${balance} < expected ${intent.expectedAmount} on ${intent.ephemeralAddress}, waiting for more`,
      );
      return;
    }
    if (balance === 0n) return;

    const sweepTxHash = await this.sweep(intent, balance);

    this.intents.delete(intent.correlationId);
    if (this.onTransferDetected) {
      await this.onTransferDetected({
        intent,
        sender: from,
        receivedAmount: balance.toString(),
        inboundTxHash: '',
        sweepTxHash,
      });
    }
  }

  private async sweep(intent: OtaIntent, amount: bigint): Promise<string | undefined> {
    if (!this.gasStation) {
      this.logger.warn(
        `OTA-deposit: no gasStation configured — leaving ${amount} at ephemeral ${intent.ephemeralAddress} (intent ${intent.correlationId}, custodyId ${intent.custodyAccountId})`,
      );
      return undefined;
    }
    await fundGasIfNeeded(this.logger, this.gasStation, intent.ephemeralWallet);

    const sweepContract = new Contract(intent.contractAddress, ERC20_TRANSFER_ABI, intent.ephemeralWallet.signer);
    const tx = await sweepContract.transfer(intent.sweepTarget, amount);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      this.logger.error(`OTA-deposit: sweep tx failed for intent ${intent.correlationId}`);
      return undefined;
    }
    this.logger.info(
      `OTA-deposit: swept ${amount} from ${intent.ephemeralAddress} → ${intent.sweepTarget} (tx ${receipt.hash})`,
    );
    return receipt.hash;
  }
}
