import { AssetBind, AssetDenomination } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { DeployContext, DeployResult } from '@owneraio/finp2p-ethereum-adapter-contract';
import { AssetStore } from '../accounts/account-resolver';

const creating = new Map<string, Promise<DeployResult>>();

export const deployContext = (
  idempotencyKey: string, assetId: string, assetBind: AssetBind,
  metadata: unknown, issuerId: string | undefined, denomination: AssetDenomination | undefined,
): DeployContext => ({ assetId, idempotencyKey, metadata, issuerId, denomination, network: assetBind.network });

/**
 * Creates the asset for assetId at most once, whatever the idempotency key: a
 * stored asset is returned as is, and a creation already running for assetId
 * is joined rather than started again.
 */
export function createAssetOnce(
  assetStore: AssetStore, assetId: string, deploy: () => Promise<DeployResult>,
): Promise<DeployResult> {
  const running = creating.get(assetId);
  if (running) return running;
  const creation = (async () => {
    const stored = await assetStore.getAsset(assetId);
    if (stored) {
      return { contractAddress: stored.contract_address, decimals: stored.decimals, tokenStandard: stored.token_standard };
    }
    const result = await deploy();
    await assetStore.saveAsset({ contract_address: result.contractAddress, decimals: result.decimals, token_standard: result.tokenStandard, id: assetId });
    return result;
  })().finally(() => creating.delete(assetId));
  creating.set(assetId, creation);
  return creation;
}
