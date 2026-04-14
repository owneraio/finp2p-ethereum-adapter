import { Asset } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { AssetRecord } from '@owneraio/finp2p-ethereum-token-standard';
import { parseEther } from 'ethers';
import winston from 'winston';
import { CustodyWallet, GasStation } from './custody-provider';
import { StorageInstance } from './account-mapping';

export async function getAssetFromDb(storage: StorageInstance, ast: Asset): Promise<AssetRecord> {
  const dbAsset = await storage.getAsset({ id: ast.assetId, type: ast.assetType });
  if (dbAsset === undefined) throw new Error(`Asset(type=${ast.assetType},id=${ast.assetId}) is not registered in DB`);
  return {
    contractAddress: dbAsset.contract_address,
    decimals: dbAsset.decimals,
    tokenStandard: dbAsset.token_standard,
  };
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
