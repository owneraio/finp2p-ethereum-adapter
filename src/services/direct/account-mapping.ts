import { finIdToAddress } from '@owneraio/finp2p-contracts';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';

export interface AccountMappingService {
  resolveAccount(finId: string): Promise<string | undefined>;
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
 * DB-backed mapping: uses skeleton's globally exposed account mapping storage functions.
 * Supports 1:N (finId → multiple accounts), resolves to the first match.
 */
export class DbAccountMapping implements AccountMappingService {

  async resolveAccount(finId: string): Promise<string | undefined> {
    const mappings = await workflows.getAccountMappings(finId);
    return mappings[0]?.account;
  }

  async resolveFinId(account: string): Promise<string | undefined> {
    const mappings = await workflows.getAccountMappingsByAccount(account);
    return mappings[0]?.fin_id;
  }

  async addMapping(finId: string, account: string): Promise<void> {
    await workflows.saveAccountMapping(finId, account);
  }

  async removeMapping(finId: string, account?: string): Promise<void> {
    await workflows.deleteAccountMapping(finId, account);
  }
}

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
