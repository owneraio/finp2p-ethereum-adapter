import { Asset, Destination, ExecutionContext, OmnibusDelegate, Source, AssetBind, LedgerReference } from '@owneraio/finp2p-adapter-models';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { parseUnits } from 'ethers';
import { ContractsManager, ERC20Contract } from '@owneraio/finp2p-contracts';
import winston from 'winston';
import { CustodyProvider } from './custody-provider';
import { getAssetFromDb, fundGasIfNeeded } from './helpers';

export class EthereumOmnibusDelegate implements OmnibusDelegate {

  constructor(
    private readonly logger: winston.Logger,
    private readonly custodyProvider: CustodyProvider,
  ) {}

  async executeExternalTransfer(
    idempotencyKey: string, source: Source, destination: Destination,
    asset: Asset, quantity: string, exCtx: ExecutionContext | undefined,
  ): Promise<{ transactionId: string }> {
    const dbAsset = await getAssetFromDb(asset);

    if (destination.account.type !== 'crypto') {
      throw new Error(`Unsupported external destination type: ${destination.account.type}`);
    }
    const destinationAddress = destination.account.address;

    const wallet = this.custodyProvider.issuer;
    const amount = parseUnits(quantity, dbAsset.decimals);
    const c = new ERC20Contract(wallet.provider, wallet.signer, dbAsset.contract_address, this.logger);
    await fundGasIfNeeded(this.logger, this.custodyProvider.gasStation, wallet);
    const tx = await c.transfer(destinationAddress, amount);
    const receipt = await tx.wait();
    if (receipt === null) throw new Error('Transaction receipt is null');

    this.logger.info(`External transfer: ${quantity} of ${asset.assetId} to ${destinationAddress}, tx: ${receipt.hash}`);
    return { transactionId: receipt.hash };
  }

  async onAssetCreated(
    idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined, assetMetadata: any | undefined,
  ): Promise<{ tokenId: string; reference: LedgerReference | undefined }> {
    const decimals = 6;

    if (assetBind === undefined || assetBind.tokenIdentifier === undefined) {
      const { provider, signer } = this.custodyProvider.issuer;
      const cm = new ContractsManager(provider, signer, this.logger);
      const erc20 = await cm.deployERC20Detached(
        'OWNERACOIN', 'OWNERA', decimals, await signer.getAddress(),
      );
      await workflows.saveAsset({ contract_address: erc20, decimals, token_standard: 'ERC20', id: asset.assetId, type: asset.assetType });
      await this.custodyProvider.onAssetRegistered?.(erc20);
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
