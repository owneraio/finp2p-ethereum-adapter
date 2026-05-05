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

export type DepositMethod = 'wallet' | 'ota' | 'pull';

/**
 * Resolved deposit method: explicit DEPOSIT_METHOD env wins; otherwise default
 * by account model — omnibus pairs naturally with ota (per-deposit ephemeral
 * address swept to the omnibus), segregated pairs with wallet (deposit to the
 * investor's own mapped W_I).
 */
export function resolveDepositMethod(accountModel: 'omnibus' | 'segregated' | string): DepositMethod {
  const explicit = process.env.DEPOSIT_METHOD;
  if (explicit === 'wallet' || explicit === 'ota' || explicit === 'pull') return explicit;
  return accountModel === 'omnibus' ? 'ota' : 'wallet';
}
