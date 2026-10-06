import {
  AssetBind, AssetCreationStatus, AssetDenomination, BusinessError, failedAssetCreation,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { VanillaServiceImpl } from '@owneraio/finp2p-vanilla-service';

/**
 * Vanilla service for the omnibus account model.
 *
 * `AssetDelegate.createAsset` can only return a successful result, so the
 * omnibus delegate signals an unsupported network/standard by throwing a
 * `BusinessError` (7311). The workflow proxy would record any thrown error
 * as a generic code-1 failure; this override turns it back into the
 * well-known business error the OAS documents for `createAsset`.
 */
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
}
