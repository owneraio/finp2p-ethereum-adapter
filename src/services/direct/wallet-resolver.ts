import { CustodyProvider, CustodyWallet } from './custody-provider';
import { FIELD_CUSTODY_ACCOUNT_ID, FIELD_LEDGER_ACCOUNT_ID } from './mapping-validator';
import { StorageInstance } from './account-mapping';

/**
 * Resolves a finId to the investor's on-chain address and custody-signed wallet,
 * using the account mapping store and the custody provider.
 */
export type WalletResolver = (finId: string) => Promise<{ walletAddress: string; wallet: CustodyWallet } | undefined>;

export function createWalletResolver(storage: StorageInstance, custodyProvider: CustodyProvider): WalletResolver {
  return async (finId) => {
    if (!custodyProvider.createWalletForCustodyId) return undefined;
    const mappings = await storage.getAccountMappings([finId]);
    if (mappings.length === 0) return undefined;
    const walletAddress = mappings[0].fields?.[FIELD_LEDGER_ACCOUNT_ID];
    const custodyAccountId = mappings[0].fields?.[FIELD_CUSTODY_ACCOUNT_ID];
    if (!walletAddress || !custodyAccountId) return undefined;
    const wallet = await custodyProvider.createWalletForCustodyId(custodyAccountId);
    return { walletAddress, wallet };
  };
}
