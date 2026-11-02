import type { TokenStandard } from './interface';
import type { DeployResult, Logger, TokenWallet } from './types';

export interface AssetDenomination {
  type: string;
  code: string;
}

/**
 * The asset-creation request as the host received it. metadata is passed
 * through untouched: its shape is the standard's own contract with whoever
 * creates the asset.
 */
export interface AssetCreationRequest {
  assetId: string;
  /** the same key on every retry of one creation */
  idempotencyKey: string;
  name?: string;
  metadata?: unknown;
  issuerId?: string;
  denomination?: AssetDenomination;
  /** CAIP-2 network the asset was requested on, when given */
  network?: string;
}

/**
 * Optional TokenStandard capability: the standard creates the asset itself,
 * in place of deploy(), when an asset is created without an existing token.
 * It may run any number of transactions; the host waits for it.
 *
 * wallet is the host's issuer wallet when one is configured; standards that
 * sign with their own keys may ignore it.
 *
 * createAsset MUST be idempotent on (assetId, idempotencyKey): the host calls
 * it again after a crash or retry, and it must return the asset it already
 * created rather than create another. Throw to fail the creation.
 */
export interface AssetCreation {
  createAsset(wallet: TokenWallet | undefined, request: AssetCreationRequest, logger: Logger): Promise<DeployResult>;
}

export function supportsAssetCreation(standard: TokenStandard): standard is TokenStandard & AssetCreation {
  return typeof (standard as Partial<AssetCreation>).createAsset === 'function';
}
