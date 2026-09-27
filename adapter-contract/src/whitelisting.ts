import type { TokenStandard } from './interface';
import type { AssetRecord, Logger, TokenOperationResult, TokenWallet } from './types';

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
 * Some admissions are signed by the party itself rather than by an agent: a
 * Stellar trustline is the holder's own transaction. For those the host passes
 * the party's wallet as `wallet`, the same `W` the standard's writes take. A
 * standard that admits with its own keys ignores it; one that needs it and is
 * not given it fails with a reason, never by guessing a signer.
 *
 * isWhitelisted is a pure check and never mutates state. whitelist and
 * dewhitelist MUST be idempotent: applying them to a party already in the
 * target state is a cheap success, not an error.
 */
export interface InvestorWhitelisting<W = TokenWallet> {
  isWhitelisted(asset: AssetRecord, party: WhitelistParty, logger: Logger): Promise<boolean>;
  whitelist(asset: AssetRecord, party: WhitelistParty, logger: Logger, wallet?: W): Promise<TokenOperationResult>;
  dewhitelist(asset: AssetRecord, party: WhitelistParty, logger: Logger, wallet?: W): Promise<TokenOperationResult>;
}

export function supportsWhitelisting<W>(standard: TokenStandard<W>): standard is TokenStandard<W> & InvestorWhitelisting<W> {
  const candidate = standard as Partial<InvestorWhitelisting<W>>;
  return typeof candidate.isWhitelisted === 'function'
    && typeof candidate.whitelist === 'function'
    && typeof candidate.dewhitelist === 'function';
}
