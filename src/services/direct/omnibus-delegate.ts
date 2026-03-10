import {
  Asset, AssetBind, AssetCreationResult, AssetDenomination, AssetIdentifier,
  Destination, ExecutionContext, Source,
} from '@owneraio/finp2p-adapter-models';
import { PayoutDelegate, AssetDelegate, DelegateResult } from '@owneraio/finp2p-vanilla-service';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { parseUnits } from 'ethers';
import { ContractsManager, ERC20Contract } from '@owneraio/finp2p-contracts';
import winston from 'winston';
import { CustodyProvider } from './custody-provider';
import { getAssetFromDb, fundGasIfNeeded } from './helpers';

export class EthereumPayoutDelegate implements PayoutDelegate {

  constructor(
    private readonly logger: winston.Logger,
    private readonly custodyProvider: CustodyProvider,
  ) {}

  async payout(
    idempotencyKey: string, source: Source, destination: Destination,
    asset: Asset, quantity: string, exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult> {
    const dbAsset = await getAssetFromDb(asset);

    if (destination.account.type !== 'crypto') {
      return { success: false, error: `Unsupported external destination type: ${destination.account.type}` };
    }
    const destinationAddress = destination.account.address;

    const wallet = this.custodyProvider.issuer;
    const amount = parseUnits(quantity, dbAsset.decimals);
    const c = new ERC20Contract(wallet.provider, wallet.signer, dbAsset.contract_address, this.logger);
    await fundGasIfNeeded(this.logger, this.custodyProvider.gasStation, wallet);
    const tx = await c.transfer(destinationAddress, amount);
    const receipt = await tx.wait();
    if (receipt === null) return { success: false, error: 'Transaction receipt is null' };

    this.logger.info(`Payout: ${quantity} of ${asset.assetId} to ${destinationAddress}, tx: ${receipt.hash}`);
    return { success: true, transactionId: receipt.hash };
  }
}

export class EthereumAssetDelegate implements AssetDelegate {

  constructor(
    private readonly logger: winston.Logger,
    private readonly custodyProvider: CustodyProvider,
  ) {}

  async createAsset(
    idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined,
    assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined,
  ): Promise<AssetCreationResult> {
    const decimals = 6;

    if (assetBind === undefined || assetBind.tokenIdentifier === undefined) {
      const { provider, signer } = this.custodyProvider.issuer;
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
