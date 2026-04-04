import {
  OperationContext, LegType, PrimaryType, Phase, ReleaseType,
} from '@owneraio/finp2p-ethereum-token-standard';
import { Asset, ExecutionContext, Signature } from '@owneraio/finp2p-nodejs-skeleton-adapter';

/**
 * Build OperationContext from adapter request parameters.
 *
 * Mirrors the on-chain OperationParams derivation in finp2p-contract helpers:
 * - LegType: detected from whether the asset matches the EIP712 asset or settlement term
 * - PrimaryType: mapped from the EIP712 template primaryType
 * - Phase: INITIATE by default; CLOSE when executionContext.sequence > 3 (REPO heuristic)
 * - ReleaseType: RELEASE by default
 */
export function buildOperationContext(
  asset: Asset,
  signature: Signature | undefined,
  exCtx: ExecutionContext | undefined,
  operationId?: string,
): OperationContext | undefined {
  if (!signature || !exCtx) return undefined;

  const template = signature.template;
  if (!template || template.type !== 'EIP712') return undefined;

  const leg = detectLeg(asset, template);
  const primaryType = mapPrimaryType(template.primaryType);

  // Phase heuristic: sequence > 3 means closing phase (REPO maturity)
  const phase = (primaryType === PrimaryType.Loan && exCtx.sequence > 3)
    ? Phase.Close
    : Phase.Initiate;

  return {
    leg,
    phase,
    primaryType,
    operationId,
    releaseType: ReleaseType.Release,
  };
}

function detectLeg(asset: Asset, template: any): LegType {
  const msg = template.message;
  if (msg?.asset && msg.asset.assetId === asset.assetId) return LegType.Asset;
  if (msg?.settlement && msg.settlement.assetId === asset.assetId) return LegType.Settlement;
  return LegType.Asset; // default
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
    default: return PrimaryType.Transfer;
  }
}
