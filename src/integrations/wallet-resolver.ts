import { CustodyProvider, CustodyWallet } from '../services/custody/custody-provider';
import { AccountResolver } from '../services/accounts/account-resolver';

/**
 * Resolves a finId to the investor's on-chain address and custody-signed wallet,
 * using the adapter's account resolver (the account mapping, or the router's
 * onboarded accounts) and the custody provider.
 */
export type WalletResolver = (finId: string) => Promise<{ walletAddress: string; wallet: CustodyWallet } | undefined>;

export function createWalletResolver(accounts: AccountResolver, custodyProvider: CustodyProvider): WalletResolver {
  return async (finId) => {
    if (!custodyProvider.createWalletForCustodyId || !accounts.resolveFullAccount) return undefined;
    const resolved = await accounts.resolveFullAccount(finId);
    if (!resolved?.custodyAccountId) return undefined;
    const wallet = await custodyProvider.createWalletForCustodyId(resolved.custodyAccountId);
    return { walletAddress: resolved.ledgerAccountId, wallet };
  };
}
