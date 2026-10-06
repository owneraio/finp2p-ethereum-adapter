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
 * whitelisting/onboarding.
 *
 * What "whitelisted" means is standard-specific — an identity-registry
 * entry, an allowlist authorization, accepting inbound transfers for a
 * token, etc. Implementations own whatever standard-specific agent keys the
 * operations need (injected at construction, same as their value-op signers).
 *
 * isWhitelisted is a pure check and never mutates state. whitelist and
 * dewhitelist MUST be idempotent: applying them to a party already in the
 * target state is a cheap success, not an error.
 */
export interface InvestorWhitelisting {
  isWhitelisted(asset: AssetRecord, party: WhitelistParty, logger: Logger): Promise<boolean>;
  whitelist(asset: AssetRecord, party: WhitelistParty, logger: Logger): Promise<TokenOperationResult>;
  dewhitelist(asset: AssetRecord, party: WhitelistParty, logger: Logger): Promise<TokenOperationResult>;
}

export function supportsWhitelisting(standard: TokenStandard): standard is TokenStandard & InvestorWhitelisting {
  const candidate = standard as Partial<InvestorWhitelisting>;
  return typeof candidate.isWhitelisted === 'function'
    && typeof candidate.whitelist === 'function'
    && typeof candidate.dewhitelist === 'function';
}
