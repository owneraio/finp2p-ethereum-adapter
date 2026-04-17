import {
  Asset, AssetBind, AssetCreationResult, AssetDenomination, AssetType,
  LedgerAssetIdentifier,
  Destination, ExecutionContext, Source,
  PaymentService, DepositAsset, DepositOperation, ReceiptOperation, Signature,
  successfulDepositOperation, failedReceiptOperation,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { TransferDelegate, AssetDelegate, EscrowDelegate, OmnibusDelegate as OmnibusDelegateInterface, DelegateResult, InboundTransferVerificationError } from '@owneraio/finp2p-vanilla-service';
import { parseUnits, id as keccak256 } from 'ethers';
import winston from 'winston';
import { CustodyProvider, CustodyWallet } from './custody-provider';
import { tokenStandardRegistry } from "./token-standards";
import { ERC20_TOKEN_STANDARD } from "./token-standards";
import { AccountMappingService } from './account-mapping';
import { AssetStore } from './asset-store';
import { getAssetFromDb } from './helpers';

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

  private readonly omnibusWallet: CustodyWallet;
  private readonly receiptPolling: ReceiptPollingConfig;

  constructor(
    private readonly logger: winston.Logger,
    private readonly custodyProvider: CustodyProvider,
    private readonly accountMapping: AccountMappingService,
    private readonly assetStore: AssetStore,
    receiptPolling?: Partial<ReceiptPollingConfig>,
  ) {
    if (!custodyProvider.omnibus) throw new Error('Omnibus wallet is required for omnibus delegate');
    this.omnibusWallet = custodyProvider.omnibus;
    this.receiptPolling = { ...defaultReceiptPolling, ...receiptPolling };
  }

  async outboundTransfer(
    idempotencyKey: string, source: Source, destination: Destination,
    sourceAsset: Asset, destinationAsset: Asset, quantity: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await getAssetFromDb(this.assetStore, sourceAsset.assetId);
    const destinationAddress = await this.accountMapping.resolveAccount(destination.finId)
      ?? destination.ledgerAccount?.address;
    if (!destinationAddress) throw new Error(`Cannot resolve address for finId: ${destination.finId}`);

    const amount = parseUnits(quantity, dbAsset.decimals);
    const standard = tokenStandardRegistry.resolve(dbAsset.tokenStandard);
    const result = await standard.transfer(this.omnibusWallet, dbAsset, destinationAddress, amount, this.logger);
    if (result.status === 'failure') return { success: false, error: result.reason };

    this.logger.info(`Outbound transfer: ${quantity} of ${sourceAsset.assetId} to ${destinationAddress}, tx: ${result.transactionId}`);
    return { success: true, transactionId: result.transactionId ?? '' };
  }

  private async pollTransactionReceipt(transactionId: string) {
    return this.custodyProvider.rpcProvider.waitForTransaction(
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
        finalizedBlockNumber = (await this.custodyProvider.rpcProvider.getBlock('finalized'))?.number;
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

    const dbAsset = await getAssetFromDb(this.assetStore, asset.assetId);
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
    const dbAsset = await getAssetFromDb(this.assetStore, asset.assetId);
    const amount = parseUnits(quantity, dbAsset.decimals);

    const standard = tokenStandardRegistry.resolve(dbAsset.tokenStandard);
    const result = await standard.hold(this.omnibusWallet, this.custodyProvider.escrow, dbAsset, amount, this.logger);
    if (result.status === 'failure') return { success: false, error: result.reason };

    this.logger.info(`Hold: ${quantity} of ${asset.assetId} from omnibus to escrow, tx: ${result.transactionId}`);
    return { success: true, transactionId: result.transactionId ?? '' };
  }

  async release(
    idempotencyKey: string, source: Source, destination: Destination,
    asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await getAssetFromDb(this.assetStore, asset.assetId);
    const omnibusAddress = await this.omnibusWallet.signer.getAddress();
    const escrowWallet = this.custodyProvider.escrow;
    const amount = parseUnits(quantity, dbAsset.decimals);

    const standard = tokenStandardRegistry.resolve(dbAsset.tokenStandard);
    const result = await standard.release(escrowWallet, dbAsset, omnibusAddress, amount, this.logger);
    if (result.status === 'failure') return { success: false, error: result.reason };

    this.logger.info(`Release: ${quantity} of ${asset.assetId} from escrow to omnibus, tx: ${result.transactionId}`);
    return { success: true, transactionId: result.transactionId ?? '' };
  }

  async rollback(
    idempotencyKey: string, source: Source,
    asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await getAssetFromDb(this.assetStore, asset.assetId);
    const omnibusAddress = await this.omnibusWallet.signer.getAddress();
    const escrowWallet = this.custodyProvider.escrow;
    const amount = parseUnits(quantity, dbAsset.decimals);

    const standard = tokenStandardRegistry.resolve(dbAsset.tokenStandard);
    const result = await standard.release(escrowWallet, dbAsset, omnibusAddress, amount, this.logger);
    if (result.status === 'failure') return { success: false, error: result.reason };

    this.logger.info(`Rollback: ${quantity} of ${asset.assetId} from escrow to omnibus, tx: ${result.transactionId}`);
    return { success: true, transactionId: result.transactionId ?? '' };
  }

  async getOmnibusBalance(assetId: string, assetType: AssetType): Promise<string> {
    const dbAsset = await getAssetFromDb(this.assetStore, assetId);
    const omnibusAddress = await this.omnibusWallet.signer.getAddress();
    const standard = tokenStandardRegistry.resolve(dbAsset.tokenStandard);
    return standard.balanceOf(this.omnibusWallet.provider, this.omnibusWallet.signer, dbAsset, omnibusAddress, this.logger);
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
    const omnibusAddress = await this.omnibusWallet.signer.getAddress();
    const network = await this.custodyProvider.rpcProvider.getNetwork();
    const chainId = Number(network.chainId);

    return successfulDepositOperation({
      asset: _asset,
      account: {
        finId: '',
        ledgerAccount: {
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
          contractAddress: '',
          walletAddress: omnibusAddress,
        },
      }],
      operationId: undefined,
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
    idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined,
    assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined,
  ): Promise<AssetCreationResult> {
    const decimals = 6;

    const tokenStandard = assetBind?.tokenIdentifier?.standard
      ? (tokenStandardRegistry.has(assetBind.tokenIdentifier.standard) ? assetBind.tokenIdentifier.standard : ERC20_TOKEN_STANDARD)
      : ERC20_TOKEN_STANDARD;
    const standard = tokenStandardRegistry.resolve(tokenStandard);

    const makeLedgerIdentifier = (tokenId: string, std: string): LedgerAssetIdentifier => ({
      assetIdentifierType: 'CAIP-19',
      network: '',
      tokenId,
      standard: std,
    });

    if (assetBind === undefined || assetBind.tokenIdentifier === undefined) {
      const symbol = 'OWNERA';
      const result = await standard.deploy(this.omnibusWallet, assetName ?? 'OWNERACOIN', symbol, decimals, this.logger);
      await this.assetStore.saveAsset({ contract_address: result.contractAddress, decimals: result.decimals, token_standard: result.tokenStandard, id: asset.assetId });
      await this.custodyProvider.onAssetRegistered?.(result.contractAddress, symbol);
      return { ledgerIdentifier: makeLedgerIdentifier(result.contractAddress, result.tokenStandard), reference: undefined };
    }

    const tokenAddress = assetBind.tokenIdentifier.tokenId;
    await this.assetStore.saveAsset({ contract_address: tokenAddress, decimals, token_standard: tokenStandard, id: asset.assetId });
    try {
      await this.custodyProvider.onAssetRegistered?.(tokenAddress);
    } catch (e) {
      this.logger.warn(`Asset registration failed (may already exist): ${e}`);
    }
    return { ledgerIdentifier: makeLedgerIdentifier(tokenAddress, tokenStandard), reference: undefined };
  }
}
