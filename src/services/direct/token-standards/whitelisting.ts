import { AssetRecord, Logger, TokenOperationResult, TokenStandard } from "@owneraio/finp2p-ethereum-ownera";

export type WhitelistPartyRole = "source" | "destination";

export interface WhitelistParty {
  finId: string;
  address: string;
  role: WhitelistPartyRole;
}

/**
 * Optional TokenStandard capability: token-standard-specific investor
 * whitelisting/onboarding, ensured at plan approval so instructions don't
 * fail at execution.
 *
 * What "whitelisted" means is standard-specific — a TREX identity-registry
 * entry, a CMTAT/ATS allowlist authorization, accepting inbound transfers for
 * a token, etc. Implementations own whatever standard-specific agent keys the
 * operation needs (injected at construction, same as their value-op signers)
 * and MUST be idempotent: ensuring an already-whitelisted party is a cheap
 * no-op, not an error.
 *
 * Defined here as a structural extension of the base TokenStandard interface;
 * candidate for upstreaming into @owneraio/finp2p-ethereum-ownera.
 */
export interface InvestorWhitelisting {
  ensureWhitelisted(asset: AssetRecord, parties: WhitelistParty[], logger: Logger): Promise<TokenOperationResult>;
}

export function supportsWhitelisting(standard: TokenStandard): standard is TokenStandard & InvestorWhitelisting {
  return typeof (standard as Partial<InvestorWhitelisting>).ensureWhitelisted === "function";
}
