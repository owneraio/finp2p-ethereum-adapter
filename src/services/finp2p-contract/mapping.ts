import { AccountMappingService, AccountMapping } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FinP2PContract } from '@owneraio/finp2p-contracts';
import { FIELD_LEDGER_ACCOUNT_ID } from '../direct/mapping-validator';

/**
 * AccountMappingService backed by the on-chain credentials registry.
 * The contract is the source of truth — no DB persistence needed.
 */
export class CredentialsMappingService implements AccountMappingService {

  constructor(private readonly finP2PContract: FinP2PContract) {}

  async getAccounts(finIds?: string[]): Promise<AccountMapping[]> {
    if (!finIds || finIds.length === 0) return [];
    const results: AccountMapping[] = [];
    for (const finId of finIds) {
      try {
        const address = await this.finP2PContract.getCredentialAddress(finId);
        results.push({ finId, fields: { [FIELD_LEDGER_ACCOUNT_ID]: address } });
      } catch {
        // credential not found — skip
      }
    }
    return results;
  }

  async getByFieldValue(fieldName: string, value: string): Promise<AccountMapping[]> {
    // On-chain registry only supports lookup by finId, not by field value
    return [];
  }

  async saveAccount(finId: string, fields: Record<string, string>): Promise<AccountMapping> {
    const address = fields[FIELD_LEDGER_ACCOUNT_ID];
    if (!address) throw new Error(`Field '${FIELD_LEDGER_ACCOUNT_ID}' is required for on-chain credential mapping`);
    await this.finP2PContract.addCredential(finId, address);
    return { finId, fields };
  }

  async deleteAccount(finId: string, _fieldName?: string): Promise<void> {
    await this.finP2PContract.removeCredential(finId);
  }
}
