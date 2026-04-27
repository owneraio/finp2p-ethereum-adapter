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
import { AssetStore, CustodyProvider, WalletResolver } from "../../../services/direct";
import { IntegrationContext } from "../../registry";
import { TransferWatcher, OtaResult } from "./transfer-watcher";

/**
 * One-time-address (OTA) deposit method: provisions a fresh custody account per deposit
 * via CustodyProvider.createCustodyAccount and returns its EVM address as the deposit
 * target. The investor sends funds to this address; a TransferWatcher detects the
 * inbound ERC20 Transfer event, sweeps the balance to the configured sweep target
 * (the investor's mapped wallet W_I in segregated mode), and reports the deposit to
 * OSS. The ephemeral key never leaves custody — the sweep is signed by the
 * custody-issued signer obtained via createWalletForCustodyId.
 *
 * Useful when the depositor's source address is not known in advance and 1:1
 * attribution (intent ↔ address) is required.
 *
 * In-memory intent store; persistence is a TODO. Note: because the custody account
 * is durable, intents can be recovered after process restart by re-instantiating
 * the wallet via createWalletForCustodyId(custodyAccountId) — the EVM key isn't
 * lost on crash, only the in-memory intent metadata is.
 *
 * Not registered when:
 *   - ACCOUNT_MODEL is omnibus (omnibus has its own flow)
 *   - DTCC_PLUGIN_ENABLED=true (DTCC owns the single PaymentsPlugin slot)
 *   - DEPOSIT_METHOD != 'ota' (default is 'wallet')
 *   - custody provider lacks createCustodyAccount / createWalletForCustodyId
 */
export function registerOtaDeposit(ctx: IntegrationContext): void {
  if (process.env.DTCC_PLUGIN_ENABLED === 'true') return;
  if (ctx.accountModel === 'omnibus') return;
  if (process.env.DEPOSIT_METHOD !== 'ota') return;

  const { pluginManager, logger, custodyProvider, assetStore, walletResolver, finP2PClient, inboundTransferHook } = ctx;
  if (!custodyProvider || !assetStore || !walletResolver) {
    logger.info('OTA-deposit plugin not registered: requires custody provider + asset store + wallet resolver');
    return;
  }
  if (!custodyProvider.createCustodyAccount || !custodyProvider.createWalletForCustodyId) {
    logger.info('OTA-deposit plugin not registered: custody provider does not support per-deposit account creation');
    return;
  }

  const network = process.env.NETWORK_NAME ?? 'ethereum';

  pluginManager.registerPaymentsPlugin(
    new OtaDepositPlugin(logger, assetStore, walletResolver, network, custodyProvider, finP2PClient, inboundTransferHook),
  );
  logger.info(`OTA-deposit plugin activated (network='${network}', inboundTransferHook=${inboundTransferHook ? 'present' : 'absent'})`);
}

class OtaDepositPlugin implements PaymentsPlugin {

  private watcher: TransferWatcher | undefined;

  constructor(
    private readonly logger: winston.Logger,
    private readonly assetStore: AssetStore,
    private readonly walletResolver: WalletResolver,
    private readonly network: string,
    private readonly custodyProvider: CustodyProvider,
    private readonly finP2PClient: FinP2PClient | undefined,
    private readonly inboundTransferHook: InboundTransferHook | undefined,
  ) {}

  private getWatcher(): TransferWatcher {
    if (this.watcher) return this.watcher;
    this.watcher = new TransferWatcher(
      this.custodyProvider.rpcProvider,
      this.logger,
      this.custodyProvider.gasStation,
      (result) => this.onTransferDetected(result),
    );
    return this.watcher;
  }

  private async onTransferDetected(result: OtaResult): Promise<void> {
    if (this.inboundTransferHook) {
      try {
        await this.inboundTransferHook.onInboundTransfer(result.intent.correlationId, {
          planId: result.intent.correlationId,
          sourceFinId: '',
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
          amount: result.receivedAmount,
          instructionSequence: 0,
          result: { type: 'receipt', transactionId: result.sweepTxHash ?? result.inboundTxHash },
        });
        this.logger.info(`OTA-deposit: inboundTransferHook delivered for intent ${result.intent.correlationId}`);
      } catch (e: any) {
        this.logger.error(`OTA-deposit: inboundTransferHook failed for intent ${result.intent.correlationId}: ${e?.message ?? e}`);
      }
      return;
    }

    if (!this.finP2PClient) {
      this.logger.warn(`OTA-deposit: no FinP2PClient configured — skipping importTransactions for intent ${result.intent.correlationId}`);
      return;
    }
    const txId = result.sweepTxHash ?? result.inboundTxHash;
    try {
      await this.finP2PClient.importTransactions([{
        id: txId,
        quantity: result.receivedAmount,
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
          transactionId: txId,
          operationId: result.intent.correlationId,
        },
        operationType: 'transfer',
      }] as any);
      this.logger.info(`OTA-deposit: importTransactions succeeded for intent ${result.intent.correlationId}`);
    } catch (e: any) {
      this.logger.error(`OTA-deposit: importTransactions failed for intent ${result.intent.correlationId}: ${e?.message ?? e}`);
    }
  }

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

    const resolved = await this.walletResolver(ownerFinId);
    if (!resolved) {
      return failedDepositOperation(1, `No wallet mapping registered for finId ${ownerFinId}`);
    }

    const correlationId = workflows.generateCid();
    const { custodyAccountId, address: ephemeralAddress } = await this.custodyProvider.createCustodyAccount!(
      `ota-${correlationId}`,
    );
    const ephemeralWallet = await this.custodyProvider.createWalletForCustodyId!(custodyAccountId);

    this.getWatcher().addIntent({
      correlationId,
      finId: ownerFinId,
      assetId: asset.assetId,
      contractAddress: dbAsset.contract_address,
      ephemeralAddress,
      custodyAccountId,
      ephemeralWallet,
      sweepTarget: resolved.walletAddress,
      expectedAmount: amount,
      createdAt: Date.now(),
    });

    this.logger.info(
      `OTA-deposit: created intent ${correlationId} for finId=${ownerFinId} custodyId=${custodyAccountId} ephemeral=${ephemeralAddress} sweepTarget=${resolved.walletAddress}`,
    );

    return successfulDepositOperation({
      asset,
      account: { finId: ownerFinId, account: { type: 'crypto', address: ephemeralAddress } },
      description: `Send ${asset.assetId} to one-time address ${ephemeralAddress}; funds will be swept to ${resolved.walletAddress}`,
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
      details: undefined,
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
}
