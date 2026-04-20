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
import { AssetStore, WalletResolver } from "../../../services/direct";
import { IntegrationContext } from "../../registry";

/**
 * Wallet-deposit method: returns the investor's own on-chain wallet address
 * (resolved from the account-mapping store) as the deposit target.
 *
 * TODO: auto-create a custody account + mapping when no mapping exists for the finId.
 * For now, deposits fail if the finId has no pre-registered wallet mapping — the
 * operator must provision it via the existing account-mapping API first.
 *
 * Not registered when:
 *   - ACCOUNT_MODEL is omnibus (omnibus has its own deposit flow)
 *   - DTCC_PLUGIN_ENABLED=true (DTCC registers its own PaymentsPlugin — single-plugin manager)
 */
export function registerWalletDeposit(ctx: IntegrationContext): void {
  const dtccEnabled = process.env.DTCC_PLUGIN_ENABLED === 'true';
  if (dtccEnabled) return;
  if (ctx.accountModel === 'omnibus') return;

  const { pluginManager, logger, assetStore, walletResolver } = ctx;
  if (!assetStore || !walletResolver) {
    logger.info('Wallet-deposit plugin not registered: requires asset store + wallet resolver');
    return;
  }

  const network = process.env.NETWORK_NAME ?? 'ethereum';
  pluginManager.registerPaymentsPlugin(new WalletDepositPlugin(logger, assetStore, walletResolver, network));
  logger.info(`Wallet-deposit plugin activated (network='${network}')`);
}

class WalletDepositPlugin implements PaymentsPlugin {

  constructor(
    private readonly logger: winston.Logger,
    private readonly assetStore: AssetStore,
    private readonly walletResolver: WalletResolver,
    private readonly network: string,
  ) {}

  async deposit(
    idempotencyKey: string,
    ownerFinId: string,
    asset: DepositAsset,
    amount: string | undefined,
    signature: Signature | undefined,
  ): Promise<DepositOperation> {
    if (asset.assetType !== 'finp2p' || !('assetId' in asset)) {
      return failedDepositOperation(1, 'Wallet deposit only supports finp2p asset type');
    }

    const dbAsset = await this.assetStore.getAsset(asset.assetId);
    if (!dbAsset) {
      return failedDepositOperation(1, `Asset ${asset.assetId} is not registered`);
    }

    const resolved = await this.walletResolver(ownerFinId);
    if (!resolved) {
      // TODO: auto-provision a custody account + mapping when missing.
      return failedDepositOperation(1, `No wallet mapping registered for finId ${ownerFinId}`);
    }

    return successfulDepositOperation({
      asset,
      account: { finId: ownerFinId, account: { type: 'crypto', address: resolved.walletAddress } },
      description: 'Wallet deposit to investor address',
      paymentOptions: [{
        description: 'Crypto transfer',
        currency: asset.assetId,
        methodInstruction: {
          type: 'cryptoTransfer',
          network: this.network,
          contractAddress: dbAsset.contract_address,
          walletAddress: resolved.walletAddress,
        },
      }],
      operationId: workflows.generateCid(),
      details: undefined,
    });
  }

  async depositCustom(
    idempotencyKey: string, ownerFinId: string, amount: string | undefined, details: any, signature: Signature | undefined,
  ): Promise<DepositOperation> {
    return failedDepositOperation(1, 'Custom deposits are not supported by wallet-deposit plugin');
  }

  async payout(
    idempotencyKey: string, sourceFinId: string, destinationFinId: string, asset: Asset, amount: string, signature: Signature | undefined,
  ): Promise<ReceiptOperation> {
    throw new Error('Payout not implemented for wallet-deposit plugin');
  }
}
