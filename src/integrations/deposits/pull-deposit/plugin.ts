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
import { AssetStore, CustodyProvider, CustodyWallet } from "../../../services/direct";
import { DepositTargetResolver } from "../types";
import { ApprovalWatcher } from "./approval-watcher";
import { PullResult } from "./models";

export class PullDepositPlugin implements PaymentsPlugin {

  private watcher: ApprovalWatcher | undefined;

  constructor(
    private readonly logger: winston.Logger,
    private readonly assetStore: AssetStore,
    private readonly resolveDepositTarget: DepositTargetResolver,
    private readonly network: string,
    private readonly operatorWallet: CustodyWallet,
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
      return failedDepositOperation(1, 'Pull deposit only supports finp2p asset type');
    }

    const dbAsset = await this.assetStore.getAsset(asset.assetId);
    if (!dbAsset) {
      return failedDepositOperation(1, `Asset ${asset.assetId} is not registered`);
    }

    const destinationAddress = await this.resolveDepositTarget(ownerFinId);
    if (!destinationAddress) {
      return failedDepositOperation(1, `No deposit target available for finId ${ownerFinId}`);
    }

    const watcher = await this.getWatcher();
    const operatorAddress = await this.operatorWallet.signer.getAddress();
    const correlationId = workflows.generateCid();

    try {
      await watcher.addDeposit({
        correlationId,
        finId: ownerFinId,
        assetId: asset.assetId,
        contractAddress: dbAsset.contract_address,
        decimals: dbAsset.decimals,
        destinationAddress,
        expectedAmount: amount,
        createdAt: Date.now(),
      });
    } catch (e: any) {
      return failedDepositOperation(1, e?.message ?? String(e));
    }

    return successfulDepositOperation({
      asset,
      account: { finId: ownerFinId, account: { type: 'crypto', address: destinationAddress } },
      description: `Approve ${operatorAddress} on the token contract to deposit into ${destinationAddress}`,
      paymentOptions: [{
        description: 'ERC20 approve + pull',
        currency: asset.assetId,
        methodInstruction: {
          type: 'cryptoTransfer',
          network: this.network,
          contractAddress: dbAsset.contract_address,
          walletAddress: operatorAddress,
        },
      }],
      operationId: correlationId,
      details: undefined,
    });
  }

  async depositCustom(
    idempotencyKey: string, ownerFinId: string, amount: string | undefined, details: any, signature: Signature | undefined,
  ): Promise<DepositOperation> {
    return failedDepositOperation(1, 'Custom deposits are not supported by pull-deposit plugin');
  }

  async payout(
    idempotencyKey: string, sourceFinId: string, destinationFinId: string, asset: Asset, amount: string, signature: Signature | undefined,
  ): Promise<ReceiptOperation> {
    throw new Error('Payout not implemented for pull-deposit plugin');
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  private async getWatcher(): Promise<ApprovalWatcher> {
    if (this.watcher) return this.watcher;
    const operatorAddress = await this.operatorWallet.signer.getAddress();
    this.watcher = new ApprovalWatcher(
      operatorAddress,
      this.operatorWallet,
      this.custodyProvider.rpcProvider,
      this.logger,
      this.custodyProvider.gasStation,
      (result) => this.onPullCompleted(result),
    );
    this.logger.info(`Pull-deposit: operator address=${operatorAddress}`);
    return this.watcher;
  }

  private async onPullCompleted(result: PullResult): Promise<void> {
    // Both paths run when present:
    //   - notifyInboundHook (omnibus mode): vanilla hook credits the operator's internal
    //     omnibus ledger (storage.credit). Without it, omnibus balances stay stale.
    //   - exportReceipt: importTransactions tells FinAPI about the deposit so the
    //     investor's finId reflects the new holdings. The vanilla hook does NOT do this.
    if (this.inboundTransferHook) {
      await this.notifyInboundHook(result);
    }
    await this.exportReceipt(result);
  }

  private async notifyInboundHook(result: PullResult): Promise<void> {
    // Synthetic plan context is used until the skeleton makes plan fields optional.
    try {
      await this.inboundTransferHook!.onInboundTransfer(result.deposit.correlationId, {
        planId: result.deposit.correlationId,
        sourceFinId: '', // TODO: no plan-scoped sender for out-of-plan deposits
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
        amount: result.amount,
        instructionSequence: 0, // TODO: no plan sequence for out-of-plan deposits
        result: { type: 'receipt', transactionId: result.txHash },
      });
      this.logger.info(`Pull-deposit: inboundTransferHook delivered for deposit ${result.deposit.correlationId}`);
    } catch (e: any) {
      this.logger.error(`Pull-deposit: inboundTransferHook failed for deposit ${result.deposit.correlationId}: ${e?.message ?? e}`);
    }
  }

  private async exportReceipt(result: PullResult): Promise<void> {
    if (!this.finP2PClient) {
      this.logger.warn(`Pull-deposit: no FinP2PClient configured — skipping importTransactions for deposit ${result.deposit.correlationId}`);
      return;
    }
    try {
      await this.finP2PClient.importTransactions([{
        id: result.txHash,
        quantity: result.amount,
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
          transactionId: result.txHash,
          operationId: result.deposit.correlationId,
        },
        operationType: 'transfer',
      }] as any);
      this.logger.info(`Pull-deposit: importTransactions succeeded for deposit ${result.deposit.correlationId}`);
    } catch (e: any) {
      this.logger.error(`Pull-deposit: importTransactions failed for deposit ${result.deposit.correlationId}: ${e?.message ?? e}`);
    }
  }
}
