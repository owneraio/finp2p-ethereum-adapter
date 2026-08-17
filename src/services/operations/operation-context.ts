import {
  OperationContext, LegType, PrimaryType, Phase, ReleaseType,
} from '@owneraio/finp2p-ethereum-adapter-contract';
import { Asset, Destination, ExecutionContext, Signature } from '@owneraio/finp2p-nodejs-skeleton-adapter';

/**
 * Build OperationContext from adapter request parameters.
 *
 * - LegType: detected from EIP712 template when available, defaults to Asset
 * - PrimaryType: mapped from EIP712 template primaryType when available, defaults to Transfer
 * - Phase: INITIATE by default; CLOSE when sequence > 3 (loan/repo maturity heuristic)
 * - ReleaseType: RELEASE unless the caller knows better (deriveReleaseType for
 *   holds, Redeem on redemption paths)
 */
export function buildOperationContext(
  asset: Asset,
  signature: Signature | undefined,
  exCtx: ExecutionContext | undefined,
  operationId?: string,
  releaseType: ReleaseType = ReleaseType.Release,
): OperationContext | undefined {
  if (!exCtx) return undefined;

  const template = (signature?.template?.type === 'EIP712') ? signature.template : undefined;
  const leg = template ? detectLeg(asset, template) : LegType.Asset;
  const primaryType = template ? mapPrimaryType(template.primaryType) : PrimaryType.Transfer;

  // Phase heuristic: sequence > 4 means closing phase (loan/repo maturity)
  const phase = exCtx.sequence > 4 ? Phase.Close : Phase.Initiate;

  return {
    leg,
    phase,
    primaryType,
    operationId,
    releaseType,
  };
}

/**
 * The disposition the escrowed amount is headed for, known at hold time: a
 * Transfer/Redemption intent with no destination investor ends in a burn.
 * Mirrors the on-chain helpers' per-template derivation.
 */
export function deriveReleaseType(signature: Signature | undefined, destination: Destination | undefined): ReleaseType {
  const template = (signature?.template?.type === 'EIP712') ? signature.template : undefined;
  const primaryType = template?.primaryType;
  if (primaryType === undefined || primaryType === 'Transfer' || primaryType === 'Redemption') {
    return destination?.finId ? ReleaseType.Release : ReleaseType.Redeem;
  }
  return ReleaseType.Release;
}

function detectLeg(asset: Asset, template: any): LegType {
  const msg = template.message;
  if (msg?.asset && msg.asset.assetId === asset.assetId) return LegType.Asset;
  if (msg?.settlement && msg.settlement.assetId === asset.assetId) return LegType.Settlement;
  return LegType.Asset;
}

function mapPrimaryType(templateType: string | undefined): PrimaryType {
  switch (templateType) {
    case 'PrimarySale': return PrimaryType.PrimarySale;
    case 'Buying': return PrimaryType.Buying;
    case 'Selling': return PrimaryType.Selling;
    case 'Redemption': return PrimaryType.Redemption;
    case 'Transfer': return PrimaryType.Transfer;
    case 'PrivateOffer': return PrimaryType.PrivateOffer;
    case 'Loan': return PrimaryType.Loan;
    case 'Move': return PrimaryType.Move;
    default: return PrimaryType.Transfer;
  }
}
