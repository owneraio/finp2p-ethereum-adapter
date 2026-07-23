import {
  Asset, AssetBind, AssetCreationResult, AssetDenomination, AssetType,
  LedgerAssetIdentifier,
  Destination, ExecutionContext, Source,
  PaymentService, DepositAsset, DepositOperation, ReceiptOperation, Signature,
  successfulDepositOperation, failedDepositOperation, failedReceiptOperation,
  workflows,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { TransferDelegate, AssetDelegate, EscrowDelegate, OmnibusDelegate as OmnibusDelegateInterface, DelegateResult, InboundTransferVerificationError } from '@owneraio/finp2p-vanilla-service';
import { parseUnits, Provider, id as keccak256 } from 'ethers';
import winston from 'winston';
import { CustodyProvider, CustodyWallet } from '../custody/custody-provider';
import { GasStation } from '../funding';
import { tokenStandardRegistry } from "../../integrations/token-standards/registry";
import { TokenStandardName as ERC20_TOKEN_STANDARD, DEFAULT_NEW_ERC20_DECIMALS } from "@owneraio/finp2p-ethereum-erc20-plugin";
import { AssetRecord } from '@owneraio/finp2p-ethereum-adapter-contract';
import { AccountResolver, AssetStore } from '../accounts/account-resolver';

export interface ReceiptPollingConfig {
  timeoutMs: number;
  intervalMs: number;
  minConfirmations: number;
  requireFinalizedBlock: boolean;
}

const defaultReceiptPolling: ReceiptPollingConfig = {
  timeoutMs: 180000,
  intervalMs: 1000,
  minConfirmations: 2,
  requireFinalizedBlock: false,
};

export class OmnibusDelegate implements TransferDelegate, AssetDelegate, EscrowDelegate, OmnibusDelegateInterface, PaymentService {

  private readonly receiptPolling: ReceiptPollingConfig;

  constructor(
    private readonly logger: winston.Logger,
    private readonly custodyProvider: CustodyProvider,
    private readonly omnibusWallet: CustodyWallet,
    private readonly escrowWallet: CustodyWallet,
    private readonly readProvider: Provider,
    private readonly gasStation: GasStation | undefined,
    private readonly accountMapping: AccountResolver,
    private readonly assetStore: AssetStore,
    receiptPolling?: Partial<ReceiptPollingConfig>,
  ) {
    if (!omnibusWallet) throw new Error('Omnibus wallet is required for omnibus delegate');
    this.receiptPolling = { ...defaultReceiptPolling, ...receiptPolling };
  }

  private async ensureGas(wallet: CustodyWallet): Promise<void> {
    if (!this.gasStation) return;
    await this.gasStation.ensureGas(await wallet.signer.getAddress());
  }

  private async assetRecord(assetId: string): Promise<AssetRecord> {
    const dbAsset = await this.assetStore.getAsset(assetId);
    if (dbAsset === undefined) throw new Error(`Asset ${assetId} is not registered in DB`);
    return {
      contractAddress: dbAsset.contract_address,
      decimals: dbAsset.decimals,
      tokenStandard: dbAsset.token_standard,
    };
  }

  async outboundTransfer(
    idempotencyKey: string, source: Source, destination: Destination,
    asset: Asset, quantity: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await this.assetRecord(asset.assetId);
    const destinationAddress = await this.accountMapping.resolveAccount(destination.finId)
      ?? destination.account?.address;
    if (!destinationAddress) throw new Error(`Cannot resolve address for finId: ${destination.finId}`);

    const amount = parseUnits(quantity, dbAsset.decimals);
    const standard = tokenStandardRegistry.resolve(dbAsset.tokenStandard);
    await this.ensureGas(this.omnibusWallet);
    const result = await standard.transfer(this.omnibusWallet, dbAsset, destinationAddress, amount, this.logger);
    if (result.status === 'failure') return { success: false, error: result.reason };

    this.logger.info(`Outbound transfer: ${quantity} of ${asset.assetId} to ${destinationAddress}, tx: ${result.transactionId}`);
    return { success: true, transactionId: result.transactionId ?? '' };
  }

  private async pollTransactionReceipt(transactionId: string) {
    return this.readProvider.waitForTransaction(
      transactionId,
      this.receiptPolling.minConfirmations,
      this.receiptPolling.timeoutMs,
    );
  }

  private async waitForFinalizedBlock(blockNumber: number): Promise<void> {
    const { timeoutMs, intervalMs } = this.receiptPolling;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      let finalizedBlockNumber: number | undefined;
      try {
        finalizedBlockNumber = (await this.readProvider.getBlock('finalized'))?.number;
      } catch (e) {
        throw new InboundTransferVerificationError(
          `Failed to fetch finalized block (RPC may not support finalized tag): ${e}`,
        );
      }

      if (finalizedBlockNumber !== undefined && finalizedBlockNumber >= blockNumber) return;
      if (Date.now() >= deadline) {
        throw new InboundTransferVerificationError(
          `Transaction block ${blockNumber} did not reach finalized state after ${timeoutMs}ms`,
        );
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  private async verifyReceiptOnChain(
    transactionId: string, asset: Asset, expectedAmount: string,
  ): Promise<void> {
    const receipt = await this.pollTransactionReceipt(transactionId);
    if (receipt === null) {
      throw new InboundTransferVerificationError(
        `Transaction ${transactionId} was not confirmed (${this.receiptPolling.minConfirmations} confirmations) after ${this.receiptPolling.timeoutMs}ms`,
      );
    }
    if (receipt.status !== 1) {
      throw new InboundTransferVerificationError(`Transaction ${transactionId} failed on-chain (status=${receipt.status})`);
    }
    if (this.receiptPolling.requireFinalizedBlock) {
      await this.waitForFinalizedBlock(receipt.blockNumber);
    }

    const dbAsset = await this.assetRecord(asset.assetId);
    if (receipt.to?.toLowerCase() !== dbAsset.contractAddress.toLowerCase()) {
      throw new InboundTransferVerificationError(
        `Transaction ${transactionId} target contract ${receipt.to} does not match asset contract ${dbAsset.contractAddress}`,
      );
    }

    const omnibusAddress = (await this.omnibusWallet.signer.getAddress()).toLowerCase();
    const transferTopic = keccak256('Transfer(address,address,uint256)');
    const matchingLog = receipt.logs.find(log =>
      log.topics[0] === transferTopic &&
      log.topics.length >= 3 &&
      log.topics[2]?.toLowerCase().endsWith(omnibusAddress.slice(2)),
    );
    if (!matchingLog) {
      throw new InboundTransferVerificationError(
        `Transaction ${transactionId} has no ERC20 Transfer event to omnibus wallet ${omnibusAddress}`,
      );
    }

    const onChainAmount = BigInt(matchingLog.data);
    let expectedAmountInUnits: bigint;
    try {
      expectedAmountInUnits = parseUnits(expectedAmount, dbAsset.decimals);
    } catch (e) {
      throw new InboundTransferVerificationError(
        `Expected amount ${expectedAmount} is invalid for ${dbAsset.decimals} decimals: ${e}`,
      );
    }
    if (onChainAmount !== expectedAmountInUnits) {
      throw new InboundTransferVerificationError(
        `Transaction ${transactionId} amount mismatch: expected ${expectedAmountInUnits.toString()} units, got ${onChainAmount.toString()} units`,
      );
    }

    // TODO(omnibus-inbound): validate Transfer `from` against a counterparty address registry keyed by
    // counterparty orgId from the plan context (e.g., orgId + chainId + asset contract -> allowed addresses).
    // Current checks only verify recipient/asset/amount.
  }

  async onInboundTransfer(
    transactionId: string, source: Source, asset: Asset,
    destination: Destination, amount: string, exCtx: ExecutionContext | undefined,
  ): Promise<void> {
    await this.verifyReceiptOnChain(transactionId, asset, amount);
    this.logger.info(`Inbound transfer verified: tx ${transactionId}, asset ${asset.assetId}`);
  }

  async hold(
    idempotencyKey: string, source: Source, destination: Destination | undefined,
    asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await this.assetRecord(asset.assetId);
    const amount = parseUnits(quantity, dbAsset.decimals);

    const standard = tokenStandardRegistry.resolve(dbAsset.tokenStandard);
    await this.ensureGas(this.omnibusWallet);
    const result = await standard.hold(this.omnibusWallet, this.escrowWallet, dbAsset, amount, this.logger);
    if (result.status === 'failure') return { success: false, error: result.reason };

    this.logger.info(`Hold: ${quantity} of ${asset.assetId} from omnibus to escrow, tx: ${result.transactionId}`);
    return { success: true, transactionId: result.transactionId ?? '' };
  }

  async release(
    idempotencyKey: string, source: Source, destination: Destination,
    asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await this.assetRecord(asset.assetId);
    const omnibusAddress = await this.omnibusWallet.signer.getAddress();
    const escrowWallet = this.escrowWallet;
    const amount = parseUnits(quantity, dbAsset.decimals);

    // Local destination (mapped in our DB → our investor): funds stay pooled in our
    // omnibus and per-finId accounting happens via vanilla's `accounts` table.
    // External destination (counterparty in another org): the router supplies the
    // counterparty's on-chain address via `destination.account.address`; deliver
    // there directly so funds physically leave this org.
    const localAddress = await this.accountMapping.resolveAccount(destination.finId);
    const externalAddress = destination.account?.address;
    if (!localAddress && !externalAddress) {
      return { success: false, error: `Cannot resolve release destination for finId: ${destination.finId}` };
    }
    const onChainTarget = localAddress ? omnibusAddress : externalAddress!;

    const standard = tokenStandardRegistry.resolve(dbAsset.tokenStandard);
    await this.ensureGas(escrowWallet);
    const result = await standard.release(escrowWallet, dbAsset, onChainTarget, amount, this.logger);
    if (result.status === 'failure') return { success: false, error: result.reason };

    this.logger.info(`Release: ${quantity} of ${asset.assetId} from escrow to ${onChainTarget} (${localAddress ? 'local omnibus' : 'external'}), tx: ${result.transactionId}`);
    return { success: true, transactionId: result.transactionId ?? '' };
  }

  async rollback(
    idempotencyKey: string, source: Source,
    asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await this.assetRecord(asset.assetId);
    const omnibusAddress = await this.omnibusWallet.signer.getAddress();
    const escrowWallet = this.escrowWallet;
    const amount = parseUnits(quantity, dbAsset.decimals);

    const standard = tokenStandardRegistry.resolve(dbAsset.tokenStandard);
    await this.ensureGas(escrowWallet);
    const result = await standard.release(escrowWallet, dbAsset, omnibusAddress, amount, this.logger);
    if (result.status === 'failure') return { success: false, error: result.reason };

    this.logger.info(`Rollback: ${quantity} of ${asset.assetId} from escrow to omnibus, tx: ${result.transactionId}`);
    return { success: true, transactionId: result.transactionId ?? '' };
  }

  async getOmnibusBalance(assetId: string, assetType: AssetType): Promise<string> {
    const dbAsset = await this.assetRecord(assetId);
    const omnibusAddress = await this.omnibusWallet.signer.getAddress();
    const standard = tokenStandardRegistry.resolve(dbAsset.tokenStandard);
    return standard.balanceOf(this.readProvider, this.omnibusWallet.signer, dbAsset, omnibusAddress, this.logger);
  }

  async getDepositInstruction(
    _idempotencyKey: string,
    _owner: Source,
    _destination: Destination,
    _asset: DepositAsset,
    _amount: string | undefined,
    _details: any | undefined,
    _nonce: string | undefined,
    _signature: Signature | undefined,
  ): Promise<DepositOperation> {
    if (_asset.assetType !== 'finp2p' || !('assetId' in _asset)) {
      return failedDepositOperation(1, 'Omnibus deposit only supports finp2p asset type');
    }
    const dbAsset = await this.assetRecord(_asset.assetId);

    const omnibusAddress = await this.omnibusWallet.signer.getAddress();
    const network = await this.readProvider.getNetwork();
    const chainId = Number(network.chainId);

    return successfulDepositOperation({
      asset: _asset,
      account: {
        // Skeleton's depositPayoutAccountToAPI reads `finId` here and emits it
        // both as the top-level finId AND as the inner discriminator's finId.
        // An empty value violates the router's minimum-length check.
        finId: _owner.finId,
        // Skeleton overwrites this inner shape unconditionally with
        // { type: 'finId', finId }; the depositor learns the on-chain address
        // from paymentOptions[].methodInstruction.walletAddress instead.
        account: {
          type: 'crypto',
          address: omnibusAddress,
        },
      },
      description: `Deposit to omnibus account on chain ${chainId}`,
      paymentOptions: [{
        description: 'Crypto transfer to omnibus wallet',
        currency: 'ETH',
        methodInstruction: {
          type: 'cryptoTransfer',
          network: `eip155:${chainId}`,
          contractAddress: dbAsset.contractAddress,
          walletAddress: omnibusAddress,
        },
      }],
      operationId: workflows.generateCid(),
      details: undefined,
    });
  }

  async payout(
    _idempotencyKey: string,
    _source: Source,
    _destination: Destination | undefined,
    _asset: Asset,
    _quantity: string,
    _description: string | undefined,
    _nonce: string | undefined,
    _signature: Signature | undefined,
  ): Promise<ReceiptOperation> {
    return failedReceiptOperation(1, 'Payout is not supported in omnibus mode');
  }

  async createAsset(
    idempotencyKey: string, assetId: string, assetBind: AssetBind | undefined,
    assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined,
  ): Promise<AssetCreationResult> {
    const tokenStandard = assetBind?.tokenIdentifier?.standard
      ? (tokenStandardRegistry.has(assetBind.tokenIdentifier.standard) ? assetBind.tokenIdentifier.standard : ERC20_TOKEN_STANDARD)
      : ERC20_TOKEN_STANDARD;
    const standard = tokenStandardRegistry.resolve(tokenStandard);

    const { chainId } = await this.readProvider.getNetwork();
    const defaultNetwork = `eip155:${chainId}`;

    const makeLedgerIdentifier = (tokenId: string, std: string, network: string): LedgerAssetIdentifier => ({
      assetIdentifierType: 'CAIP-19',
      network,
      tokenId,
      standard: std,
    });

    if (assetBind === undefined || assetBind.tokenIdentifier === undefined) {
      const symbol = 'OWNERA';
      await this.ensureGas(this.omnibusWallet);
      const result = await standard.deploy(this.omnibusWallet, assetName ?? 'OWNERACOIN', symbol, DEFAULT_NEW_ERC20_DECIMALS, this.logger);
      await this.assetStore.saveAsset({ contract_address: result.contractAddress, decimals: result.decimals, token_standard: result.tokenStandard, id: assetId });
      // TODO(custody-registration): onAssetRegistered forwards to the custody
      // provider's ERC20 registration (Fireblocks registerNewAsset). It is an
      // ERC20-custody-only concern — collateral/registry standards are not
      // custody-held tokens and fail registration — and it lost its gate when
      // isErc20Compatible was retired. Disabled pending a purpose-specific
      // capability; reassess whether this feature is needed before re-enabling.
      // await this.custodyProvider.onAssetRegistered?.(result.contractAddress, symbol);
      return { ledgerIdentifier: makeLedgerIdentifier(result.contractAddress, result.tokenStandard, defaultNetwork), reference: undefined };
    }

    const tokenAddress = assetBind.tokenIdentifier.tokenId;
    const network = assetBind.tokenIdentifier.network || defaultNetwork;
    const decimals = await standard.decimals(this.readProvider, tokenAddress, this.logger);
    await this.assetStore.saveAsset({ contract_address: tokenAddress, decimals, token_standard: tokenStandard, id: assetId });
    // TODO(custody-registration): see the deploy path above — disabled pending
    // a purpose-specific capability; reassess before re-enabling.
    // await this.custodyProvider.onAssetRegistered?.(tokenAddress);
    return { ledgerIdentifier: makeLedgerIdentifier(tokenAddress, tokenStandard, network), reference: undefined };
  }
}
