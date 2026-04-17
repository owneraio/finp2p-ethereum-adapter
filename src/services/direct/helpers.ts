import { AssetRecord } from '@owneraio/finp2p-ethereum-token-standard';
import { parseEther } from 'ethers';
import winston from 'winston';
import { CustodyWallet, GasStation } from './custody-provider';
import { AssetStore } from './asset-store';

export async function getAssetFromDb(assetStore: AssetStore, assetId: string): Promise<AssetRecord> {
  const dbAsset = await assetStore.getAsset(assetId);
  if (dbAsset === undefined) throw new Error(`Asset ${assetId} is not registered in DB`);
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
