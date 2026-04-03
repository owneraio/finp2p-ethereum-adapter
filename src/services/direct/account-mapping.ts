import { finIdToAddress } from '@owneraio/finp2p-contracts';
import { MappingService, OwnerMapping, workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FIELD_LEDGER_ACCOUNT_ID } from './mapping-validator';

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
 * DB-backed mapping: uses skeleton's multi-field account mapping storage.
 * Resolves ledgerAccountId field for address lookups.
 * Also implements MappingService for the mapping API routes.
 */
export class DbAccountMapping implements AccountMappingService, MappingService {

  async resolveAccount(finId: string): Promise<string | undefined> {
    const mappings = await workflows.getAccountMappings([finId]);
    if (mappings.length === 0) return undefined;
    return mappings[0].fields[FIELD_LEDGER_ACCOUNT_ID];
  }

  async resolveFinId(account: string): Promise<string | undefined> {
    const mappings = await workflows.getAccountMappingsByFieldValue(FIELD_LEDGER_ACCOUNT_ID, account);
    if (mappings.length === 0) return undefined;
    return mappings[0].finId;
  }

  async getOwnerMappings(finIds?: string[]): Promise<OwnerMapping[]> {
    return workflows.getAccountMappings(finIds);
  }

  async getByFieldValue(fieldName: string, value: string): Promise<OwnerMapping[]> {
    return workflows.getAccountMappingsByFieldValue(fieldName, value);
  }

  async saveOwnerMapping(finId: string, fields: Record<string, string>): Promise<OwnerMapping> {
    return workflows.saveAccountMapping(finId, fields);
  }

  async deleteOwnerMapping(finId: string, fieldName?: string): Promise<void> {
    return workflows.deleteAccountMapping(finId, fieldName);
  }
}
