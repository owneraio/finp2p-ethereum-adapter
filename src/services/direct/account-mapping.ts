import { finIdToAddress } from '@owneraio/finp2p-contracts';
import { storage } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FIELD_LEDGER_ACCOUNT_ID, FIELD_CUSTODY_ACCOUNT_ID } from './mapping-validator';

export type AccountMappingStore = InstanceType<typeof storage.PgAccountStore>;
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
 * DB-backed mapping: uses skeleton's account store for address resolution.
 */
/**
 * Custody-provider-based mapping: queries the custody provider's address list
 * and maintains a bidirectional in-memory cache.
 */
export class CustodyAccountMapping implements AccountMappingService {
  private readonly finIdToAccount = new Map<string, string>();
  private readonly accountToFinId = new Map<string, string>();

  constructor(
    private readonly listAccounts: () => Promise<Array<{ finId: string; account: string }>>,
  ) {}

  private cacheEntry(finId: string, account: string): void {
    this.finIdToAccount.set(finId, account);
    this.accountToFinId.set(account.toLowerCase(), finId);
  }

  private async refresh(): Promise<void> {
    const entries = await this.listAccounts();
    for (const { finId, account } of entries) {
      this.cacheEntry(finId, account);
    }
  }

  async resolveAccount(finId: string): Promise<string | undefined> {
    const cached = this.finIdToAccount.get(finId);
    if (cached) return cached;
    await this.refresh();
    return this.finIdToAccount.get(finId);
  }

  async resolveFinId(account: string): Promise<string | undefined> {
    const cached = this.accountToFinId.get(account.toLowerCase());
    if (cached) return cached;
    await this.refresh();
    return this.accountToFinId.get(account.toLowerCase());
  }
}

export class DbAccountMapping implements AccountMappingService {
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
