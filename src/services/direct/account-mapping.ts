import { finIdToAddress } from '@owneraio/finp2p-contracts';
import { Pool } from 'pg';

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

    const address = finIdToAddress(finId);
    this.finIdToAccount.set(finId, address);
    this.accountToFinId.set(address.toLowerCase(), finId);
    return address;
  }

  async resolveFinId(account: string): Promise<string | undefined> {
    return this.accountToFinId.get(account.toLowerCase());
  }
}

/**
 * DB-backed mapping: explicit finId ↔ account entries stored in PostgreSQL.
 */
export class DbAccountMapping implements AccountMappingService {
  constructor(private readonly pool: Pool) {}

  async resolveAccount(finId: string): Promise<string | undefined> {
    const result = await this.pool.query(
      'SELECT account FROM ledger_adapter.account_mappings WHERE fin_id = $1',
      [finId]
    );
    return result.rows[0]?.account;
  }

  async resolveFinId(account: string): Promise<string | undefined> {
    const result = await this.pool.query(
      'SELECT fin_id FROM ledger_adapter.account_mappings WHERE LOWER(account) = LOWER($1)',
      [account]
    );
    return result.rows[0]?.fin_id;
  }

  async addMapping(finId: string, account: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ledger_adapter.account_mappings (fin_id, account)
       VALUES ($1, $2)
       ON CONFLICT (fin_id) DO UPDATE SET account = $2, updated_at = CURRENT_TIMESTAMP`,
      [finId, account]
    );
  }

  async removeMapping(finId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM ledger_adapter.account_mappings WHERE fin_id = $1',
      [finId]
    );
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
