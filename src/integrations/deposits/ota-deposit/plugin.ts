import winston from "winston";
import { Contract, Provider } from "ethers";
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
import { AssetStore, CustodyProvider, CustodyWallet, GasStation } from "../../../services/direct";
import { fundGasIfNeeded } from "../../../services/direct/helpers";
import { IntegrationContext } from "../../registry";
import { DepositTargetResolver } from "../types";

const ERC20_TRANSFER_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
];

const DEFAULT_POLL_INTERVAL_MS = 5000;

interface OtaIntent {
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

interface OtaResult {
  intent: OtaIntent;
  sender: string;
  receivedAmount: string;
  inboundTxHash: string;
  sweepTxHash: string | undefined;
}

/**
 * Per-intent balance-poll watcher: every `pollIntervalMs` it queries
 * `balanceOf(ephemeralAddress)` for each open intent. When the balance crosses the
 * expected threshold, it sweeps to `sweepTarget` (gas funded via the operator's
 * gas-station), invokes onTransferDetected, and stops polling for that intent.
 *
 * Polling rather than event subscription because event-listener semantics vary across
 * providers (Fireblocks BrowserProvider drops filters; public RPCs garbage-collect them),
 * and we already know the destination address per intent — direct balanceOf is simpler
 * and deterministic.
 */
class BalanceWatcher {
  private readonly intents = new Map<string, OtaIntent>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly provider: Provider,
    private readonly logger: winston.Logger,
    private readonly gasStation: GasStation | undefined,
    private readonly onTransferDetected: (result: OtaResult) => Promise<void>,
    private readonly pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ) {}

  addIntent(intent: OtaIntent): void {
    this.intents.set(intent.correlationId, intent);
    this.logger.info(`OTA-deposit: polling balanceOf(${intent.ephemeralAddress}) on ${intent.contractAddress} every ${this.pollIntervalMs}ms`);
    const timer = setInterval(() => {
      this.pollOnce(intent).catch((e) =>
        this.logger.error(`OTA-deposit: poll failed for intent ${intent.correlationId}: ${e?.message ?? e}`),
      );
    }, this.pollIntervalMs);
    this.timers.set(intent.correlationId, timer);
  }

  private stop(correlationId: string): void {
    const t = this.timers.get(correlationId);
    if (t) clearInterval(t);
    this.timers.delete(correlationId);
    this.intents.delete(correlationId);
    this.inFlight.delete(correlationId);
  }

  private async pollOnce(intent: OtaIntent): Promise<void> {
    if (this.inFlight.has(intent.correlationId)) return;
    if (!this.intents.has(intent.correlationId)) return;
    const contract = new Contract(intent.contractAddress, ERC20_TRANSFER_ABI, this.provider);
    const balance: bigint = await contract.balanceOf(intent.ephemeralAddress);
    if (balance === 0n) return;
    if (intent.expectedAmount && balance < BigInt(intent.expectedAmount)) {
      this.logger.info(`OTA-deposit: balance ${balance} < expected ${intent.expectedAmount} on ${intent.ephemeralAddress}, waiting for more`);
      return;
    }
    this.inFlight.add(intent.correlationId);
    try {
      this.logger.info(`OTA-deposit: detected balance ${balance} on ${intent.ephemeralAddress} for intent ${intent.correlationId}`);
      const sweepTxHash = await this.sweep(intent, balance);
      this.stop(intent.correlationId);
      await this.onTransferDetected({
        intent,
        sender: '',
        receivedAmount: balance.toString(),
        inboundTxHash: '',
        sweepTxHash,
      });
    } finally {
      this.inFlight.delete(intent.correlationId);
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
    this.logger.info(`OTA-deposit: swept ${amount} from ${intent.ephemeralAddress} → ${intent.sweepTarget} (tx ${receipt.hash})`);
    return receipt.hash;
  }
}

/**
 * One-time-address (OTA) deposit method: provisions a fresh custody account per deposit
 * via CustodyProvider.createCustodyAccount and returns its EVM address as the deposit
 * target. The investor sends funds to this address; a BalanceWatcher detects the
 * inbound ERC20 Transfer event, sweeps the balance to the configured sweep target,
 * and exports a receipt to FinAPI. The ephemeral key never leaves custody — the sweep
 * is signed by the custody-issued signer obtained via createWalletForCustodyId.
 *
 * Sweep target depends on account model:
 *   - segregated: the investor's mapped wallet W_I (resolved via walletResolver)
 *   - omnibus:    the operator's omnibus wallet (custodyProvider.omnibus)
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
 *   - DTCC_PLUGIN_ENABLED=true (DTCC owns the single PaymentsPlugin slot)
 *   - DEPOSIT_METHOD != 'ota' (default is 'wallet')
 *   - custody provider lacks createCustodyAccount / createWalletForCustodyId
 *   - segregated mode without walletResolver, or omnibus mode without an omnibus wallet
 */
export function registerOtaDeposit(ctx: IntegrationContext): void {
  if (process.env.DTCC_PLUGIN_ENABLED === 'true') return;
  if (process.env.DEPOSIT_METHOD !== 'ota') return;

  const { pluginManager, logger, custodyProvider, assetStore, walletResolver, accountModel, finP2PClient, inboundTransferHook } = ctx;
  if (!custodyProvider || !assetStore) {
    logger.info('OTA-deposit plugin not registered: requires custody provider + asset store');
    return;
  }
  if (!custodyProvider.createCustodyAccount || !custodyProvider.createWalletForCustodyId) {
    logger.info('OTA-deposit plugin not registered: custody provider does not support per-deposit account creation');
    return;
  }
  if (accountModel === 'omnibus' && !custodyProvider.omnibus) {
    logger.info('OTA-deposit plugin not registered (omnibus mode): custody provider has no omnibus wallet configured');
    return;
  }
  if (accountModel === 'segregated' && !walletResolver) {
    logger.info('OTA-deposit plugin not registered (segregated mode): no wallet resolver available');
    return;
  }

  const network = process.env.NETWORK_NAME ?? 'ethereum';

  let resolveSweepTarget: DepositTargetResolver;
  if (accountModel === 'omnibus') {
    let omnibusAddress: string | undefined;
    resolveSweepTarget = async () => {
      if (!omnibusAddress) omnibusAddress = await custodyProvider.omnibus!.signer.getAddress();
      return omnibusAddress;
    };
  } else {
    resolveSweepTarget = async (finId) => (await walletResolver!(finId))?.walletAddress;
  }

  pluginManager.registerPaymentsPlugin(
    new OtaDepositPlugin(logger, assetStore, resolveSweepTarget, network, custodyProvider, finP2PClient, inboundTransferHook),
  );
  logger.info(`OTA-deposit plugin activated (network='${network}', accountModel='${accountModel}', inboundTransferHook=${inboundTransferHook ? 'present' : 'absent'})`);
}

class OtaDepositPlugin implements PaymentsPlugin {

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

  private getWatcher(): BalanceWatcher {
    if (this.watcher) return this.watcher;
    this.watcher = new BalanceWatcher(
      this.custodyProvider.rpcProvider,
      this.logger,
      this.custodyProvider.gasStation,
      (result) => this.onTransferDetected(result),
    );
    return this.watcher;
  }

  private async onTransferDetected(result: OtaResult): Promise<void> {
    if (this.inboundTransferHook) {
      await this.notifyInboundHook(result);
    } else {
      await this.exportReceipt(result);
    }
    await this.archiveIfSwept(result);
  }

  private async archiveIfSwept(result: OtaResult): Promise<void> {
    if (!result.sweepTxHash) return; // funds still at the ephemeral — keep the account around
    if (!this.custodyProvider.archiveCustodyAccount) return;
    try {
      await this.custodyProvider.archiveCustodyAccount(result.intent.custodyAccountId);
      this.logger.info(`OTA-deposit: archived custody account ${result.intent.custodyAccountId}`);
    } catch (e: any) {
      this.logger.warn(`OTA-deposit: archive failed for ${result.intent.custodyAccountId}: ${e?.message ?? e}`);
    }
  }

  private async notifyInboundHook(result: OtaResult): Promise<void> {
    try {
      await this.inboundTransferHook!.onInboundTransfer(result.intent.correlationId, {
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
  }

  private async exportReceipt(result: OtaResult): Promise<void> {
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

    const sweepTarget = await this.resolveSweepTarget(ownerFinId);
    if (!sweepTarget) {
      return failedDepositOperation(1, `No sweep target available for finId ${ownerFinId}`);
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
      sweepTarget,
      expectedAmount: amount,
      createdAt: Date.now(),
    });

    this.logger.info(
      `OTA-deposit: created intent ${correlationId} for finId=${ownerFinId} custodyId=${custodyAccountId} ephemeral=${ephemeralAddress} sweepTarget=${sweepTarget}`,
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
}
