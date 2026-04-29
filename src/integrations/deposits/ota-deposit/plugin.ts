import winston from "winston";
import {
  PaymentsPlugin,
  DepositAsset,
  DepositOperation,
  Asset,
  ReceiptOperation,
  Signature,
  InboundTransferHook,
} from "@owneraio/finp2p-nodejs-skeleton-adapter/plugin";
import {
  workflows,
  successfulDepositOperation,
  failedDepositOperation,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { AssetStore, CustodyProvider } from "../../../services/direct";
import { DepositTargetResolver } from "../types";
import { BalanceWatcher } from "./balance-watcher";
import { OtaResult } from "./models";

export class OtaDepositPlugin implements PaymentsPlugin {

  private watcher: BalanceWatcher | undefined;

  constructor(
    private readonly logger: winston.Logger,
    private readonly assetStore: AssetStore,
    private readonly resolveSweepTarget: DepositTargetResolver,
    private readonly network: string,
    private readonly custodyProvider: CustodyProvider,
    private readonly finP2PClient: FinP2PClient | undefined,
    private readonly inboundTransferHook: InboundTransferHook | undefined,
  ) {}

  // ─── PaymentsPlugin interface ───────────────────────────────────────────────

  async deposit(
    idempotencyKey: string,
    ownerFinId: string,
    asset: DepositAsset,
    amount: string | undefined,
    signature: Signature | undefined,
  ): Promise<DepositOperation> {
    if (asset.assetType !== 'finp2p' || !('assetId' in asset)) {
      return failedDepositOperation(1, 'OTA deposit only supports finp2p asset type');
    }

    const dbAsset = await this.assetStore.getAsset(asset.assetId);
    if (!dbAsset) {
      return failedDepositOperation(1, `Asset ${asset.assetId} is not registered`);
    }

    const sweepTarget = await this.resolveSweepTarget(ownerFinId);
    if (!sweepTarget) {
      return failedDepositOperation(1, `No sweep target available for finId ${ownerFinId}`);
    }

    const correlationId = workflows.generateCid();
    const { custodyAccountId, address: ephemeralAddress } = await this.custodyProvider.createCustodyAccount!(
      `ota-${correlationId}`,
    );
    const ephemeralWallet = await this.custodyProvider.createWalletForCustodyId!(custodyAccountId);

    this.getWatcher().addDeposit({
      correlationId,
      finId: ownerFinId,
      assetId: asset.assetId,
      contractAddress: dbAsset.contract_address,
      ephemeralAddress,
      custodyAccountId,
      ephemeralWallet,
      sweepTarget,
      expectedAmount: amount,
      createdAt: Date.now(),
    });

    this.logger.info(
      `OTA-deposit: created deposit ${correlationId} for finId=${ownerFinId} custodyId=${custodyAccountId} ephemeral=${ephemeralAddress} sweepTarget=${sweepTarget}`,
    );

    return successfulDepositOperation({
      asset,
      account: { finId: ownerFinId, account: { type: 'crypto', address: ephemeralAddress } },
      description: `Send ${asset.assetId} to one-time address ${ephemeralAddress}; funds will be swept to ${sweepTarget}`,
      paymentOptions: [{
        description: 'One-time-address deposit',
        currency: asset.assetId,
        methodInstruction: {
          type: 'cryptoTransfer',
          network: this.network,
          contractAddress: dbAsset.contract_address,
          walletAddress: ephemeralAddress,
        },
      }],
      operationId: correlationId,
      // Surface the underlying custody account id so operators (and integration tests)
      // can inspect/audit the per-deposit account directly via the custody provider.
      details: { custodyAccountId },
    });
  }

  async depositCustom(
    idempotencyKey: string, ownerFinId: string, amount: string | undefined, details: any, signature: Signature | undefined,
  ): Promise<DepositOperation> {
    return failedDepositOperation(1, 'Custom deposits are not supported by ota-deposit plugin');
  }

  async payout(
    idempotencyKey: string, sourceFinId: string, destinationFinId: string, asset: Asset, amount: string, signature: Signature | undefined,
  ): Promise<ReceiptOperation> {
    throw new Error('Payout not implemented for ota-deposit plugin');
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  private getWatcher(): BalanceWatcher {
    if (this.watcher) return this.watcher;
    this.watcher = new BalanceWatcher(
      this.logger,
      this.custodyProvider.gasStation,
      (result: OtaResult) => this.onTransferDetected(result),
    );
    return this.watcher;
  }

  private async onTransferDetected(result: OtaResult): Promise<void> {
    // Both paths run when present:
    //   - notifyInboundHook (omnibus mode): vanilla hook credits the operator's internal
    //     omnibus ledger (storage.credit). Without it, omnibus balances stay stale.
    //   - exportReceipt: importTransactions tells FinAPI about the deposit so the
    //     investor's finId reflects the new holdings. The vanilla hook does NOT do this.
    if (this.inboundTransferHook) {
      await this.notifyInboundHook(result);
    }
    await this.exportReceipt(result);
    await this.archiveIfSwept(result);
  }

  private async archiveIfSwept(result: OtaResult): Promise<void> {
    if (!this.custodyProvider.archiveCustodyAccount) return;
    try {
      await this.custodyProvider.archiveCustodyAccount(result.deposit.custodyAccountId);
      this.logger.info(`OTA-deposit: archived custody account ${result.deposit.custodyAccountId}`);
    } catch (e: any) {
      this.logger.warn(`OTA-deposit: archive failed for ${result.deposit.custodyAccountId}: ${e?.message ?? e}`);
    }
  }

  private async notifyInboundHook(result: OtaResult): Promise<void> {
    try {
      await this.inboundTransferHook!.onInboundTransfer(result.deposit.correlationId, {
        planId: result.deposit.correlationId,
        sourceFinId: '',
        destinationFinId: result.deposit.finId,
        asset: {
          assetId: result.deposit.assetId,
          assetType: 'finp2p',
          ledgerIdentifier: {
            assetIdentifierType: 'CAIP-19',
            network: this.network,
            tokenId: result.deposit.contractAddress,
            standard: 'ERC20',
          },
        },
        amount: result.receivedAmount,
        instructionSequence: 0,
        result: { type: 'receipt', transactionId: result.sweepTxHash },
      });
      this.logger.info(`OTA-deposit: inboundTransferHook delivered for deposit ${result.deposit.correlationId}`);
    } catch (e: any) {
      this.logger.error(`OTA-deposit: inboundTransferHook failed for deposit ${result.deposit.correlationId}: ${e?.message ?? e}`);
    }
  }

  private async exportReceipt(result: OtaResult): Promise<void> {
    if (!this.finP2PClient) {
      this.logger.warn(`OTA-deposit: no FinP2PClient configured — skipping importTransactions for deposit ${result.deposit.correlationId}`);
      return;
    }
    try {
      await this.finP2PClient.importTransactions([{
        id: result.sweepTxHash,
        quantity: result.receivedAmount,
        timestamp: Math.floor(Date.now() / 1000),
        destination: {
          finp2pAccount: {
            account: { finId: result.deposit.finId },
            asset: {
              id: result.deposit.assetId,
              ledgerIdentifier: {
                assetIdentifierType: 'CAIP-19',
                network: this.network,
                tokenId: result.deposit.contractAddress,
                standard: 'ERC20',
              },
            },
          },
        },
        transactionDetails: {
          transactionId: result.sweepTxHash,
          operationId: result.deposit.correlationId,
        },
        operationType: 'transfer',
      }] as any);
      this.logger.info(`OTA-deposit: importTransactions succeeded for deposit ${result.deposit.correlationId}`);
    } catch (e: any) {
      this.logger.error(`OTA-deposit: importTransactions failed for deposit ${result.deposit.correlationId}: ${e?.message ?? e}`);
    }
  }
}
