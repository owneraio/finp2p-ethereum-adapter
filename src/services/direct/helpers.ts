import { AssetRecord } from '@owneraio/finp2p-ethereum-adapter-contract';
import { AssetStore } from './account-mapping';

export async function getAssetFromDb(assetStore: AssetStore, assetId: string): Promise<AssetRecord> {
  const dbAsset = await assetStore.getAsset(assetId);
  if (dbAsset === undefined) throw new Error(`Asset ${assetId} is not registered in DB`);
  return {
    contractAddress: dbAsset.contract_address,
    decimals: dbAsset.decimals,
    tokenStandard: dbAsset.token_standard,
  };
}
