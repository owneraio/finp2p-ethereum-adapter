import {
  OperationContext, LegType, PrimaryType, Phase, ReleaseType,
} from '@owneraio/finp2p-ethereum-token-standard';
import { Asset, ExecutionContext, Signature } from '@owneraio/finp2p-nodejs-skeleton-adapter';

/**
 * Build OperationContext from adapter request parameters.
 *
 * - LegType: detected from EIP712 template when available, defaults to Asset
 * - PrimaryType: mapped from EIP712 template primaryType when available, defaults to Transfer
 * - Phase: INITIATE by default; CLOSE when sequence > 3 (loan/repo maturity heuristic)
 * - ReleaseType: RELEASE by default
 */
export function buildOperationContext(
  asset: Asset,
  signature: Signature | undefined,
  exCtx: ExecutionContext | undefined,
  operationId?: string,
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
    releaseType: ReleaseType.Release,
  };
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
    default: return PrimaryType.Transfer;
  }
}
