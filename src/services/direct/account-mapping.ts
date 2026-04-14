import { finIdToAddress } from '@owneraio/finp2p-contracts';
import { MappingService, OwnerMapping, storage } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FIELD_LEDGER_ACCOUNT_ID, FIELD_CUSTODY_ACCOUNT_ID } from './mapping-validator';

export type AccountMappingStore = InstanceType<typeof storage.PgAccountMappingStore>;
export type AssetStore = InstanceType<typeof storage.PgAssetStore>;

export interface ResolvedAccount {
  ledgerAccountId: string;
  custodyAccountId?: string;
}

export interface AccountMappingService {
  resolveAccount(finId: string): Promise<string | undefined>;
  resolveFullAccount?(finId: string): Promise<ResolvedAccount | undefined>;
  resolveFinId(account: string): Promise<string | undefined>;
}

/**
 * Deterministic derivation: finId (compressed secp256k1 pubkey) → Ethereum address.
 * Bidirectional cache for reverse lookups.
 */
export class DerivationAccountMapping implements AccountMappingService {
  private readonly finIdToAccount = new Map<string, string>();
  private readonly accountToFinId = new Map<string, string>();

  async resolveAccount(finId: string): Promise<string | undefined> {
    const cached = this.finIdToAccount.get(finId);
    if (cached) return cached;

    try {
      const address = finIdToAddress(finId);
      this.finIdToAccount.set(finId, address);
      this.accountToFinId.set(address.toLowerCase(), finId);
      return address;
    } catch {
      return undefined;
    }
  }

  async resolveFinId(account: string): Promise<string | undefined> {
    return this.accountToFinId.get(account.toLowerCase());
  }
}

/**
 * DB-backed mapping: uses skeleton's multi-field account mapping storage.
 * Resolves ledgerAccountId field for address lookups.
 * Also implements MappingService for the mapping API routes.
 */
export class DbAccountMapping implements AccountMappingService, MappingService {
  constructor(private readonly accountMappingStore: AccountMappingStore) {}

  async resolveAccount(finId: string): Promise<string | undefined> {
    const mappings = await this.accountMappingStore.getOwnerMappings([finId]);
    if (mappings.length === 0) return undefined;
    return mappings[0].fields[FIELD_LEDGER_ACCOUNT_ID];
  }

  async resolveFullAccount(finId: string): Promise<ResolvedAccount | undefined> {
    const mappings = await this.accountMappingStore.getOwnerMappings([finId]);
    if (mappings.length === 0) return undefined;
    const ledgerAccountId = mappings[0].fields[FIELD_LEDGER_ACCOUNT_ID];
    if (!ledgerAccountId) return undefined;
    return {
      ledgerAccountId,
      custodyAccountId: mappings[0].fields[FIELD_CUSTODY_ACCOUNT_ID],
    };
  }

  async resolveFinId(account: string): Promise<string | undefined> {
    const mappings = await this.accountMappingStore.getByFieldValue(FIELD_LEDGER_ACCOUNT_ID, account);
    if (mappings.length === 0) return undefined;
    return mappings[0].finId;
  }

  async getOwnerMappings(finIds?: string[]): Promise<OwnerMapping[]> {
    return this.accountMappingStore.getOwnerMappings(finIds);
  }

  async getByFieldValue(fieldName: string, value: string): Promise<OwnerMapping[]> {
    return this.accountMappingStore.getByFieldValue(fieldName, value);
  }

  async saveOwnerMapping(finId: string, fields: Record<string, string>): Promise<OwnerMapping> {
    return this.accountMappingStore.saveOwnerMapping(finId, fields);
  }

  async deleteOwnerMapping(finId: string, fieldName?: string): Promise<void> {
    return this.accountMappingStore.deleteOwnerMapping(finId, fieldName);
  }
}
