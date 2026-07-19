import type { TokenStandard } from './interface';
import type { AssetRecord, Logger, TokenOperationResult } from './types';

export type WhitelistPartyRole = 'source' | 'destination' | 'escrow';

export interface WhitelistParty {
  /** absent for the escrow custody wallet, which has no finId */
  finId?: string;
  address: string;
  role: WhitelistPartyRole;
}

/**
 * Optional TokenStandard capability: token-standard-specific investor
 * whitelisting/onboarding, ensured at plan approval so instructions don't
 * fail at execution.
 *
 * What "whitelisted" means is standard-specific — an identity-registry
 * entry, an allowlist authorization, accepting inbound transfers for a
 * token, etc. Implementations own whatever standard-specific agent keys the
 * operation needs (injected at construction, same as their value-op signers)
 * and MUST be idempotent: ensuring an already-whitelisted party is a cheap
 * no-op, not an error.
 */
export interface InvestorWhitelisting {
  ensureWhitelisted(asset: AssetRecord, parties: WhitelistParty[], logger: Logger): Promise<TokenOperationResult>;
}

export function supportsWhitelisting(standard: TokenStandard): standard is TokenStandard & InvestorWhitelisting {
  return typeof (standard as Partial<InvestorWhitelisting>).ensureWhitelisted === 'function';
}
