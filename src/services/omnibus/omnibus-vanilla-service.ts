import {
  AssetBind, AssetCreationStatus, AssetDenomination, BusinessError, failedAssetCreation,
  SwapOperation, failedSwapOperation,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { VanillaServiceImpl } from '@owneraio/finp2p-vanilla-service';

export class OmnibusVanillaService extends VanillaServiceImpl {
  async createAsset(
    idempotencyKey: string, assetId: string,
    assetBind: AssetBind, assetMetadata: any | undefined,
    assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined,
  ): Promise<AssetCreationStatus> {
    try {
      return await super.createAsset(idempotencyKey, assetId, assetBind, assetMetadata, assetName, issuerId, assetDenomination);
    } catch (e) {
      if (e instanceof BusinessError) {
        return failedAssetCreation(e.code, e.message);
      }
      throw e;
    }
  }

  async swap(): Promise<SwapOperation> {
    return failedSwapOperation(1, 'Swap is not supported in omnibus mode');
  }
}
