import winston from "winston";
import {
  PaymentsPlugin,
  DepositAsset,
  DepositOperation,
  Asset,
  ReceiptOperation,
  Signature,
} from "@owneraio/finp2p-nodejs-skeleton-adapter/plugin";
import {
  workflows,
  successfulDepositOperation,
  failedDepositOperation,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { AssetStore, CustodyProvider, CustodyWallet, WalletResolver } from "../../../services/direct";
import { IntegrationContext } from "../../registry";
import { ApprovalWatcher } from "./approval-watcher";

/**
 * Pull-deposit method: returns the adapter's operator address as the spender to approve.
 * The investor approves from their external wallet (E_I). The ApprovalWatcher detects
 * the approval and executes transferFrom(E_I, W_I, amount) — moving funds into the
 * investor's adapter-managed wallet (W_I, resolved from the account mapping).
 *
 * The operator wallet (env / adapter constant) is the ERC20 spender AND the transferFrom
 * signer. For v1 it reuses `custodyProvider.escrow`; a dedicated
 * PULL_DEPOSIT_OPERATOR_CUSTODY_ID can be added later.
 *
 * In-memory intent store; persistence is a TODO — see ApprovalWatcher.
 *
 * Not registered when:
 *   - ACCOUNT_MODEL is omnibus (omnibus has its own flow)
 *   - DTCC_PLUGIN_ENABLED=true (DTCC owns the single PaymentsPlugin slot)
 *   - DEPOSIT_METHOD != 'pull' (default is 'wallet', handled by wallet-deposit)
 */
export function registerPullDeposit(ctx: IntegrationContext): void {
  if (process.env.DTCC_PLUGIN_ENABLED === 'true') return;
  if (ctx.accountModel === 'omnibus') return;
  if (process.env.DEPOSIT_METHOD !== 'pull') return;

  const { pluginManager, logger, custodyProvider, assetStore, walletResolver } = ctx;
  if (!custodyProvider || !assetStore || !walletResolver) {
    logger.info('Pull-deposit plugin not registered: requires custody provider + asset store + wallet resolver');
    return;
  }

  const network = process.env.NETWORK_NAME ?? 'ethereum';
  const operatorWallet = custodyProvider.escrow;

  pluginManager.registerPaymentsPlugin(
    new PullDepositPlugin(logger, assetStore, walletResolver, network, operatorWallet, custodyProvider),
  );
  logger.info(`Pull-deposit plugin activated (network='${network}')`);
}

class PullDepositPlugin implements PaymentsPlugin {

  private watcher: ApprovalWatcher | undefined;

  constructor(
    private readonly logger: winston.Logger,
    private readonly assetStore: AssetStore,
    private readonly walletResolver: WalletResolver,
    private readonly network: string,
    private readonly operatorWallet: CustodyWallet,
    private readonly custodyProvider: CustodyProvider,
  ) {}

  private async getWatcher(): Promise<ApprovalWatcher> {
    if (this.watcher) return this.watcher;
    const operatorAddress = await this.operatorWallet.signer.getAddress();
    this.watcher = new ApprovalWatcher(
      operatorAddress,
      this.operatorWallet.signer,
      this.custodyProvider.rpcProvider,
      this.logger,
    );
    this.logger.info(`Pull-deposit: operator address=${operatorAddress}`);
    return this.watcher;
  }

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

    const resolved = await this.walletResolver(ownerFinId);
    if (!resolved) {
      return failedDepositOperation(1, `No wallet mapping registered for finId ${ownerFinId}`);
    }

    const watcher = await this.getWatcher();
    const operatorAddress = await this.operatorWallet.signer.getAddress();
    const correlationId = workflows.generateCid();

    watcher.addIntent({
      correlationId,
      finId: ownerFinId,
      contractAddress: dbAsset.contract_address,
      destinationAddress: resolved.walletAddress,
      expectedAmount: amount,
      createdAt: Date.now(),
    });

    return successfulDepositOperation({
      asset,
      account: { finId: ownerFinId, account: { type: 'crypto', address: resolved.walletAddress } },
      description: `Approve ${operatorAddress} on the token contract to deposit into ${resolved.walletAddress}`,
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
}
