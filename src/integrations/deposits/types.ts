/**
 * Resolves the on-chain address that an investor's deposit funds should land at,
 * given their finId. Returns undefined if no destination is available (e.g. unmapped
 * investor in segregated mode).
 *
 * Constructed at registration time based on accountModel:
 *  - segregated: looks up the investor's mapped W_I via the wallet resolver
 *  - omnibus:    returns the operator's omnibus wallet address (constant)
 *
 * Used by deposit-method plugins (wallet-deposit, pull-deposit, ota-deposit) to keep
 * the plugin itself decoupled from the account-model branching.
 */
export type DepositTargetResolver = (finId: string) => Promise<string | undefined>;
