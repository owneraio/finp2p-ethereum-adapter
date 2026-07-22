import { storage } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FIELD_LEDGER_ACCOUNT_ID, FIELD_CUSTODY_ACCOUNT_ID } from './mapping-validator';

export type AccountMappingStore = storage.AccountStore;
export type AssetStore = InstanceType<typeof storage.PgAssetStore>;

export interface ResolvedAccount {
  ledgerAccountId: string;
  custodyAccountId?: string;
}

export interface AccountResolver {
  resolveAccount(finId: string): Promise<string | undefined>;
  resolveFullAccount?(finId: string): Promise<ResolvedAccount | undefined>;
  resolveFinId(account: string): Promise<string | undefined>;
}

/**
 * DB-backed mapping: uses skeleton's account store for address resolution.
 */
export class DbAccountResolver implements AccountResolver {
  constructor(private readonly accountStore: AccountMappingStore) {}

  async resolveAccount(finId: string): Promise<string | undefined> {
    const mappings = await this.accountStore.getAccounts([finId]);
    if (mappings.length === 0) return undefined;
    return mappings[0].fields[FIELD_LEDGER_ACCOUNT_ID];
  }

  async resolveFullAccount(finId: string): Promise<ResolvedAccount | undefined> {
    const mappings = await this.accountStore.getAccounts([finId]);
    if (mappings.length === 0) return undefined;
    const ledgerAccountId = mappings[0].fields[FIELD_LEDGER_ACCOUNT_ID];
    if (!ledgerAccountId) return undefined;
    return {
      ledgerAccountId,
      custodyAccountId: mappings[0].fields[FIELD_CUSTODY_ACCOUNT_ID],
    };
  }

  async resolveFinId(account: string): Promise<string | undefined> {
    const mappings = await this.accountStore.getByFieldValue(FIELD_LEDGER_ACCOUNT_ID, account);
    if (mappings.length === 0) return undefined;
    return mappings[0].finId;
  }
}
