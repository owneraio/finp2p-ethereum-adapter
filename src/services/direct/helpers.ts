import { Asset } from '@owneraio/finp2p-adapter-models';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { parseEther } from 'ethers';
import winston from 'winston';
import { CustodyWallet, GasStation } from './custody-provider';

export async function getAssetFromDb(ast: Asset): Promise<workflows.Asset> {
  const asset = await workflows.getAsset({ id: ast.assetId, type: ast.assetType });
  if (asset === undefined) throw new Error(`Asset(type=${ast.assetType},id=${ast.assetId}) is not registered in DB`);
  return asset;
}

export async function fundGasIfNeeded(logger: winston.Logger, gasStation: GasStation | undefined, wallet: CustodyWallet): Promise<void> {
  if (!gasStation) return;
  try {
    const targetAddress = await wallet.signer.getAddress();
    await gasStation.wallet.signer.sendTransaction({
      to: targetAddress,
      value: parseEther(gasStation.amount),
    });
  } catch (e) {
    logger.warn(`Gas funding failed (wallet may already have sufficient gas): ${e}`);
  }
}
