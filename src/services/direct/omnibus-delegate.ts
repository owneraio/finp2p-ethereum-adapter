import {
  Asset, AssetBind, AssetCreationResult, AssetDenomination, AssetIdentifier,
  Destination, ExecutionContext, Source,
} from '@owneraio/finp2p-adapter-models';
import { TransferDelegate, AssetDelegate, EscrowDelegate, DelegateResult, InboundTransferVerificationError } from '@owneraio/finp2p-vanilla-service';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { parseUnits } from 'ethers';
import { ContractsManager, ERC20Contract } from '@owneraio/finp2p-contracts';
import winston from 'winston';
import { CustodyProvider, CustodyWallet } from './custody-provider';
import { getAssetFromDb } from './helpers';

export class OmnibusDelegate implements TransferDelegate, AssetDelegate, EscrowDelegate {

  private readonly omnibusWallet: CustodyWallet;

  constructor(
    private readonly logger: winston.Logger,
    private readonly custodyProvider: CustodyProvider,
  ) {
    if (!custodyProvider.omnibus) throw new Error('Omnibus wallet is required for vanilla delegate');
    this.omnibusWallet = custodyProvider.omnibus;
  }

  async outboundTransfer(
    idempotencyKey: string, source: Source, destination: Destination,
    asset: Asset, quantity: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await getAssetFromDb(asset);

    if (destination.account.type !== 'crypto') {
      return { success: false, error: `Unsupported external destination type: ${destination.account.type}` };
    }
    const destinationAddress = destination.account.address;

    const amount = parseUnits(quantity, dbAsset.decimals);
    const c = new ERC20Contract(this.omnibusWallet.provider, this.omnibusWallet.signer, dbAsset.contract_address, this.logger);
    const tx = await c.transfer(destinationAddress, amount);
    const receipt = await tx.wait();
    if (receipt === null) return { success: false, error: 'Transaction receipt is null' };

    this.logger.info(`Outbound transfer: ${quantity} of ${asset.assetId} to ${destinationAddress}, tx: ${receipt.hash}`);
    return { success: true, transactionId: receipt.hash };
  }

  async onInboundTransfer(
    transactionId: string, source: Source, asset: Asset,
    destination: Destination, amount: string, exCtx: ExecutionContext | undefined,
  ): Promise<void> {
    const receipt = await this.custodyProvider.rpcProvider.getTransactionReceipt(transactionId);
    if (receipt === null) {
      throw new InboundTransferVerificationError(`Transaction ${transactionId} not found on-chain`);
    }
    if (receipt.status !== 1) {
      throw new InboundTransferVerificationError(`Transaction ${transactionId} failed on-chain (status=${receipt.status})`);
    }
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
    assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined,
  ): Promise<AssetCreationResult> {
    const decimals = 6;

    if (assetBind === undefined || assetBind.tokenIdentifier === undefined) {
      const { provider, signer } = this.omnibusWallet;
      const cm = new ContractsManager(provider, signer, this.logger);
      const symbol = assetIdentifier?.value ?? 'OWNERA';
      const erc20 = await cm.deployERC20Detached(
        assetName ?? 'OWNERACOIN', symbol, decimals, await signer.getAddress(),
      );
      await workflows.saveAsset({ contract_address: erc20, decimals, token_standard: 'ERC20', id: asset.assetId, type: asset.assetType });
      await this.custodyProvider.onAssetRegistered?.(erc20, symbol);
      return { tokenId: erc20, reference: undefined };
    }

    const tokenAddress = assetBind.tokenIdentifier.tokenId;
    await workflows.saveAsset({ contract_address: tokenAddress, decimals, token_standard: 'ERC20', id: asset.assetId, type: asset.assetType });
    try {
      await this.custodyProvider.onAssetRegistered?.(tokenAddress);
    } catch (e) {
      this.logger.warn(`Asset registration failed (may already exist): ${e}`);
    }
    return { tokenId: tokenAddress, reference: undefined };
  }
}
