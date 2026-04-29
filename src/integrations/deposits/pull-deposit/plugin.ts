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
import { IntegrationContext } from "../../registry";
import { DepositTargetResolver } from "../types";
import { ApprovalWatcher } from "./approval-watcher";
import { PullResult } from "./models";

/**
 * Pull-deposit method: returns the adapter's operator address as the spender to approve.
 * The investor approves from their external wallet (E_I). The ApprovalWatcher detects
 * the approval and executes transferFrom(E_I, destination, amount) — moving funds into
 * the deposit target.
 *
 * Destination depends on account model:
 *   - segregated: the investor's mapped wallet W_I (via walletResolver)
 *   - omnibus:    the operator's omnibus wallet
 *
 * After a successful transferFrom, the plugin either delegates crediting to an
 * InboundTransferHook (omnibus) or calls finP2PClient.importTransactions to register
 * the deposit with FinAPI (segregated).
 *
 * The operator wallet (env / adapter constant) is the ERC20 spender AND the transferFrom
 * signer. For v1 it reuses `custodyProvider.escrow`; a dedicated
 * PULL_DEPOSIT_OPERATOR_CUSTODY_ID can be added later.
 *
 * In-memory intent store; persistence is a TODO — see ApprovalWatcher.
 *
 * Not registered when:
 *   - DTCC_PLUGIN_ENABLED=true (DTCC owns the single PaymentsPlugin slot)
 *   - DEPOSIT_METHOD != 'pull' (default is 'wallet', handled by wallet-deposit)
 *   - segregated mode without walletResolver, or omnibus mode without an omnibus wallet
 */
export function registerPullDeposit(ctx: IntegrationContext): void {
  if (process.env.DTCC_PLUGIN_ENABLED === 'true') return;
  if (process.env.DEPOSIT_METHOD !== 'pull') return;

  const { pluginManager, logger, custodyProvider, assetStore, walletResolver, accountModel, finP2PClient, inboundTransferHook } = ctx;
  if (!custodyProvider || !assetStore) {
    logger.info('Pull-deposit plugin not registered: requires custody provider + asset store');
    return;
  }
  if (accountModel === 'omnibus' && !custodyProvider.omnibus) {
    logger.info('Pull-deposit plugin not registered (omnibus mode): custody provider has no omnibus wallet configured');
    return;
  }
  if (accountModel === 'segregated' && !walletResolver) {
    logger.info('Pull-deposit plugin not registered (segregated mode): no wallet resolver available');
    return;
  }

  const network = process.env.NETWORK_NAME ?? 'ethereum';
  const operatorWallet = custodyProvider.escrow;

  let resolveDepositTarget: DepositTargetResolver;
  if (accountModel === 'omnibus') {
    let omnibusAddress: string | undefined;
    resolveDepositTarget = async () => {
      if (!omnibusAddress) omnibusAddress = await custodyProvider.omnibus!.signer.getAddress();
      return omnibusAddress;
    };
  } else {
    resolveDepositTarget = async (finId) => (await walletResolver!(finId))?.walletAddress;
  }

  pluginManager.registerPaymentsPlugin(
    new PullDepositPlugin(logger, assetStore, resolveDepositTarget, network, operatorWallet, custodyProvider, finP2PClient, inboundTransferHook),
  );
  logger.info(`Pull-deposit plugin activated (network='${network}', accountModel='${accountModel}', inboundTransferHook=${inboundTransferHook ? 'present' : 'absent'})`);
}

class PullDepositPlugin implements PaymentsPlugin {

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

    await watcher.addIntent({
      correlationId,
      finId: ownerFinId,
      assetId: asset.assetId,
      contractAddress: dbAsset.contract_address,
      destinationAddress,
      expectedAmount: amount,
      createdAt: Date.now(),
    });

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
    // When an InboundTransferHook is provided (omnibus mode), delegate crediting entirely to the hook —
    // its implementation is expected to call distributionService.distribute + finP2PClient.importTransactions.
    // Synthetic plan context is used until the skeleton makes plan fields optional.
    if (this.inboundTransferHook) {
      try {
        await this.inboundTransferHook.onInboundTransfer(result.intent.correlationId, {
          planId: result.intent.correlationId,
          sourceFinId: '', // TODO: no plan-scoped sender for out-of-plan deposits
          destinationFinId: result.intent.finId,
          asset: {
            assetId: result.intent.assetId,
            assetType: 'finp2p',
            ledgerIdentifier: {
              assetIdentifierType: 'CAIP-19',
              network: this.network,
              tokenId: result.intent.contractAddress,
              standard: 'ERC20',
            },
          },
          amount: result.amount,
          instructionSequence: 0, // TODO: no plan sequence for out-of-plan deposits
          result: { type: 'receipt', transactionId: result.txHash },
        });
        this.logger.info(`Pull-deposit: inboundTransferHook delivered for intent ${result.intent.correlationId}`);
      } catch (e: any) {
        this.logger.error(`Pull-deposit: inboundTransferHook failed for intent ${result.intent.correlationId}: ${e?.message ?? e}`);
      }
      return;
    }

    if (!this.finP2PClient) {
      this.logger.warn(`Pull-deposit: no FinP2PClient configured — skipping importTransactions for intent ${result.intent.correlationId}`);
      return;
    }
    try {
      await this.finP2PClient.importTransactions([{
        id: result.txHash,
        quantity: result.amount,
        timestamp: Math.floor(Date.now() / 1000),
        destination: {
          finp2pAccount: {
            account: { finId: result.intent.finId },
            asset: {
              id: result.intent.assetId,
              ledgerIdentifier: {
                assetIdentifierType: 'CAIP-19',
                network: this.network,
                tokenId: result.intent.contractAddress,
                standard: 'ERC20',
              },
            },
          },
        },
        transactionDetails: {
          transactionId: result.txHash,
          operationId: result.intent.correlationId,
        },
        operationType: 'transfer',
      }] as any);
      this.logger.info(`Pull-deposit: importTransactions succeeded for intent ${result.intent.correlationId}`);
    } catch (e: any) {
      this.logger.error(`Pull-deposit: importTransactions failed for intent ${result.intent.correlationId}: ${e?.message ?? e}`);
    }
  }
}
