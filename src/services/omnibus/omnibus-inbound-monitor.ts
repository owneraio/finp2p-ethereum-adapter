import { AssetType } from "@owneraio/finp2p-adapter-models";
import { Provider, TransactionReceipt, zeroPadValue } from "ethers";
import { id as keccak256 } from "ethers";
import winston from "winston";
import { LedgerStorage } from "@owneraio/finp2p-vanilla-service";
import { CustodyProvider } from "../direct/custody-provider";
import {
  ObservedOmnibusDeposit,
  OmnibusDepositIntent,
  OmnibusInboundStore,
  TrackedOmnibusAsset,
} from "./store";

export interface OmnibusInboundMonitorConfig {
  intervalMs: number;
  confirmations: number;
  initialLookbackBlocks: number;
}

const DEFAULT_MONITOR_CONFIG: OmnibusInboundMonitorConfig = {
  intervalMs: 30_000,
  confirmations: 2,
  initialLookbackBlocks: 5_000,
};

const OMNIBUS_FIN_ID = "__omnibus__";
const TRANSFER_TOPIC = keccak256("Transfer(address,address,uint256)");

function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

export interface OmnibusBalanceReader {
  getOmnibusBalance(assetId: string, assetType: AssetType): Promise<string>;
}

export class OmnibusInboundMonitor {
  private readonly config: OmnibusInboundMonitorConfig;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly logger: winston.Logger,
    private readonly custodyProvider: CustodyProvider,
    private readonly store: OmnibusInboundStore,
    private readonly ledgerStorage: LedgerStorage,
    private readonly omnibusBalanceReader: OmnibusBalanceReader,
    config?: Partial<OmnibusInboundMonitorConfig>,
  ) {
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
  }

  start(): void {
    if (!this.custodyProvider.omnibus || this.timer) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  async runOnce(): Promise<void> {
    if (!this.custodyProvider.omnibus) return;

    await this.store.expirePendingDepositIntents();
    const trackedAssets = await this.store.listTrackedAssets();
    for (const asset of trackedAssets) {
      await this.scanAsset(asset);
      await this.processDetectedDeposits(asset);
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (e) {
      this.logger.error(`Omnibus inbound monitor failed: ${e}`);
    } finally {
      this.running = false;
    }
  }

  private async scanAsset(asset: TrackedOmnibusAsset): Promise<void> {
    const provider = this.custodyProvider.rpcProvider;
    const latestBlock = await provider.getBlockNumber();
    const confirmedBlock = latestBlock - this.config.confirmations;
    if (confirmedBlock < 0) return;

    const cursorKey = this.cursorKey(asset);
    const previousCursor = await this.store.getMonitorCursor(cursorKey);
    const fromBlock = previousCursor === undefined
      ? Math.max(0, confirmedBlock - this.config.initialLookbackBlocks + 1)
      : previousCursor + 1;

    if (fromBlock > confirmedBlock) {
      if (previousCursor === undefined) {
        await this.store.saveMonitorCursor(cursorKey, confirmedBlock);
      }
      return;
    }

    const omnibusAddress = (await this.custodyProvider.omnibus!.signer.getAddress()).toLowerCase();
    const logs = await provider.getLogs({
      address: asset.tokenContractAddress,
      fromBlock,
      toBlock: confirmedBlock,
      topics: [TRANSFER_TOPIC, null, zeroPadValue(omnibusAddress, 32)],
    });

    for (const log of logs) {
      await this.store.recordObservedDeposit({
        transactionHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: log.blockNumber,
        assetId: asset.assetId,
        assetType: asset.assetType,
        tokenContractAddress: asset.tokenContractAddress,
        tokenDecimals: asset.tokenDecimals,
        senderAddress: topicToAddress(log.topics[1]),
        recipientAddress: topicToAddress(log.topics[2]),
        amountUnits: BigInt(log.data).toString(),
      });
    }

    await this.store.saveMonitorCursor(cursorKey, confirmedBlock);
  }

  private async processDetectedDeposits(asset: TrackedOmnibusAsset): Promise<void> {
    const detected = await this.store.listDetectedDeposits(asset.assetId, asset.assetType);
    if (detected.length === 0) return;

    let pendingIntents = await this.store.listPendingDepositIntents(asset.assetId, asset.assetType);
    for (const observed of detected) {
      const match = this.matchIntent(observed, pendingIntents);
      if (match.kind === "none") {
        await this.store.setObservedDepositFailureReason(
          observed.transactionHash,
          observed.logIndex,
          "No pending deposit intent matched this transfer",
        );
        continue;
      }
      if (match.kind === "ambiguous") {
        await this.store.setObservedDepositFailureReason(
          observed.transactionHash,
          observed.logIndex,
          "Multiple pending deposit intents matched this transfer",
        );
        continue;
      }

      await this.ensureReceiptSucceeded(this.custodyProvider.rpcProvider, observed.transactionHash);
      const onChainBalance = await this.omnibusBalanceReader.getOmnibusBalance(
        asset.assetId,
        asset.assetType,
      );
      await this.ledgerStorage.syncOmnibusBalance(
        OMNIBUS_FIN_ID,
        asset.assetId,
        onChainBalance,
        asset.assetType,
      );
      await this.ledgerStorage.ensureAccount(match.intent.destinationFinId, asset.assetId, asset.assetType);
      await this.ledgerStorage.move(
        OMNIBUS_FIN_ID,
        match.intent.destinationFinId,
        match.intent.expectedAmount,
        asset.assetId,
        {
          idempotency_key: `external-deposit:${observed.transactionHash}:${observed.logIndex}`,
          operation_id: match.intent.referenceId,
          operation_type: "external-deposit",
          transaction_id: observed.transactionHash,
        },
        asset.assetType,
      );
      await this.store.markDepositIntentFulfilled(
        match.intent.referenceId,
        observed.transactionHash,
        observed.logIndex,
      );
      await this.store.markObservedDepositFulfilled(
        observed.transactionHash,
        observed.logIndex,
        match.intent.referenceId,
      );
      pendingIntents = pendingIntents.filter((intent) => intent.referenceId !== match.intent.referenceId);
      this.logger.info(
        `Fulfilled external omnibus deposit ${match.intent.referenceId} from ${observed.transactionHash}:${observed.logIndex}`,
      );
    }
  }

  private matchIntent(
    observed: ObservedOmnibusDeposit,
    pendingIntents: OmnibusDepositIntent[],
  ): { kind: "none" } | { kind: "ambiguous" } | { kind: "matched"; intent: OmnibusDepositIntent } {
    const exactSenderMatches = pendingIntents.filter((intent) =>
      intent.expectedAmountUnits === observed.amountUnits &&
      intent.senderAddress === observed.senderAddress,
    );
    if (exactSenderMatches.length === 1) {
      return { kind: "matched", intent: exactSenderMatches[0] };
    }
    if (exactSenderMatches.length > 1) {
      return { kind: "ambiguous" };
    }

    const genericMatches = pendingIntents.filter((intent) =>
      intent.expectedAmountUnits === observed.amountUnits &&
      intent.senderAddress === undefined,
    );
    if (genericMatches.length === 1) {
      return { kind: "matched", intent: genericMatches[0] };
    }
    if (genericMatches.length > 1) {
      return { kind: "ambiguous" };
    }
    return { kind: "none" };
  }

  private async ensureReceiptSucceeded(provider: Provider, transactionHash: string): Promise<void> {
    const receipt = await provider.getTransactionReceipt(transactionHash) as TransactionReceipt | null;
    if (!receipt) {
      throw new Error(`Observed transfer ${transactionHash} has no transaction receipt`);
    }
    if (receipt.status !== 1) {
      throw new Error(`Observed transfer ${transactionHash} failed on-chain`);
    }
  }

  private cursorKey(asset: TrackedOmnibusAsset): string {
    return `omnibus:${asset.assetType}:${asset.assetId}:${asset.tokenContractAddress.toLowerCase()}`;
  }
}
