import {
  Asset, AssetBind, AssetCreationResult, AssetDenomination,
  Destination, ExecutionContext, Source,
} from '@owneraio/finp2p-adapter-models';
import { TransferDelegate, AssetDelegate, EscrowDelegate, DelegateResult, InboundTransferVerificationError } from '@owneraio/finp2p-vanilla-service';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { parseUnits, formatUnits, id as keccak256 } from 'ethers';
import { ContractsManager, ERC20Contract } from '@owneraio/finp2p-contracts';
import winston from 'winston';
import { CustodyProvider, CustodyWallet } from './custody-provider';
import { AccountMappingService } from './account-mapping';
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

export class OmnibusDelegate implements TransferDelegate, AssetDelegate, EscrowDelegate {

  private readonly omnibusWallet: CustodyWallet;
  private readonly receiptPolling: ReceiptPollingConfig;

  constructor(
    private readonly logger: winston.Logger,
    private readonly custodyProvider: CustodyProvider,
    private readonly accountMapping: AccountMappingService,
    receiptPolling?: Partial<ReceiptPollingConfig>,
  ) {
    if (!custodyProvider.omnibus) throw new Error('Omnibus wallet is required for omnibus delegate');
    this.omnibusWallet = custodyProvider.omnibus;
    this.receiptPolling = { ...defaultReceiptPolling, ...receiptPolling };
  }

  private async resolveDestinationAddress(destination: Destination): Promise<string> {
    switch (destination.account.type) {
      case 'crypto':
        return destination.account.address;
      case 'finId': {
        const address = await this.accountMapping.resolveAccount(destination.account.finId);
        if (address === undefined) throw new Error(`Cannot resolve address for finId: ${destination.account.finId}`);
        return address;
      }
      default:
        throw new Error(`Unsupported destination type: ${destination.account.type}`);
    }
  }

  async outboundTransfer(
    idempotencyKey: string, source: Source, destination: Destination,
    sourceAsset: Asset, destinationAsset: Asset, quantity: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await getAssetFromDb(sourceAsset);
    const destinationAddress = await this.resolveDestinationAddress(destination);

    const amount = parseUnits(quantity, dbAsset.decimals);
    const c = new ERC20Contract(this.omnibusWallet.provider, this.omnibusWallet.signer, dbAsset.contract_address, this.logger);
    const tx = await c.transfer(destinationAddress, amount);
    const receipt = await tx.wait();
    if (receipt === null) return { success: false, error: 'Transaction receipt is null' };

    this.logger.info(`Outbound transfer: ${quantity} of ${sourceAsset.assetId} to ${destinationAddress}, tx: ${receipt.hash}`);
    return { success: true, transactionId: receipt.hash };
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

    const dbAsset = await getAssetFromDb(asset);
    if (receipt.to?.toLowerCase() !== dbAsset.contract_address.toLowerCase()) {
      throw new InboundTransferVerificationError(
        `Transaction ${transactionId} target contract ${receipt.to} does not match asset contract ${dbAsset.contract_address}`,
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

    const onChainAmount = formatUnits(BigInt(matchingLog.data), dbAsset.decimals);
    if (onChainAmount !== expectedAmount) {
      throw new InboundTransferVerificationError(
        `Transaction ${transactionId} amount mismatch: expected ${expectedAmount}, got ${onChainAmount}`,
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
    const dbAsset = await getAssetFromDb(asset);
    const escrowAddress = await this.custodyProvider.escrow.signer.getAddress();
    const amount = parseUnits(quantity, dbAsset.decimals);

    const c = new ERC20Contract(this.omnibusWallet.provider, this.omnibusWallet.signer, dbAsset.contract_address, this.logger);
    const tx = await c.transfer(escrowAddress, amount);
    const receipt = await tx.wait();
    if (receipt === null) return { success: false, error: 'Transaction receipt is null' };

    this.logger.info(`Hold: ${quantity} of ${asset.assetId} from omnibus to escrow, tx: ${receipt.hash}`);
    return { success: true, transactionId: receipt.hash };
  }

  async release(
    idempotencyKey: string, source: Source, destination: Destination,
    asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await getAssetFromDb(asset);
    const omnibusAddress = await this.omnibusWallet.signer.getAddress();
    const escrowWallet = this.custodyProvider.escrow;
    const amount = parseUnits(quantity, dbAsset.decimals);

    const c = new ERC20Contract(escrowWallet.provider, escrowWallet.signer, dbAsset.contract_address, this.logger);
    const tx = await c.transfer(omnibusAddress, amount);
    const receipt = await tx.wait();
    if (receipt === null) return { success: false, error: 'Transaction receipt is null' };

    this.logger.info(`Release: ${quantity} of ${asset.assetId} from escrow to omnibus, tx: ${receipt.hash}`);
    return { success: true, transactionId: receipt.hash };
  }

  async rollback(
    idempotencyKey: string, source: Source,
    asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await getAssetFromDb(asset);
    const omnibusAddress = await this.omnibusWallet.signer.getAddress();
    const escrowWallet = this.custodyProvider.escrow;
    const amount = parseUnits(quantity, dbAsset.decimals);

    const c = new ERC20Contract(escrowWallet.provider, escrowWallet.signer, dbAsset.contract_address, this.logger);
    const tx = await c.transfer(omnibusAddress, amount);
    const receipt = await tx.wait();
    if (receipt === null) return { success: false, error: 'Transaction receipt is null' };

    this.logger.info(`Rollback: ${quantity} of ${asset.assetId} from escrow to omnibus, tx: ${receipt.hash}`);
    return { success: true, transactionId: receipt.hash };
  }

  async createAsset(
    idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined,
    assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined
  ): Promise<AssetCreationResult> {
    const decimals = 6;

    if (assetBind === undefined || assetBind.tokenIdentifier === undefined) {
      const { provider, signer } = this.omnibusWallet;
      const cm = new ContractsManager(provider, signer, this.logger);
      const symbol = 'OWNERA';
      const erc20 = await cm.deployERC20Detached(
        assetName ?? 'OWNERACOIN', symbol, decimals, await signer.getAddress(),
      );
      await workflows.saveAsset({ contract_address: erc20, decimals, token_standard: 'ERC20', id: asset.assetId, type: asset.assetType });
      await this.custodyProvider.onAssetRegistered?.(erc20, symbol);
      return { ledgerIdentifier: { network: 'ethereum', tokenId: erc20, standard: 'ERC20' }, reference: undefined };
    }

    const tokenAddress = assetBind.tokenIdentifier.tokenId;
    await workflows.saveAsset({ contract_address: tokenAddress, decimals, token_standard: 'ERC20', id: asset.assetId, type: asset.assetType });
    try {
      await this.custodyProvider.onAssetRegistered?.(tokenAddress);
    } catch (e) {
      this.logger.warn(`Asset registration failed (may already exist): ${e}`);
    }
    return { ledgerIdentifier: { network: 'ethereum', tokenId: tokenAddress, standard: 'ERC20' }, reference: undefined };
  }
}
