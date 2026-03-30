import { MappingService, OwnerMapping } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FinP2PContract } from '@owneraio/finp2p-contracts';

/**
 * MappingService backed by the on-chain credentials registry.
 * The contract is the source of truth — no DB persistence needed.
 */
export class CredentialsMappingService implements MappingService {

  constructor(private readonly finP2PContract: FinP2PContract) {}

  async getOwnerMappings(finIds?: string[]): Promise<OwnerMapping[]> {
    if (!finIds || finIds.length === 0) return [];
    const results: OwnerMapping[] = [];
    for (const finId of finIds) {
      try {
        const account = await this.finP2PContract.getCredentialAddress(finId);
        results.push({ finId, account });
      } catch {
        // credential not found — skip
      }
    }
    return results;
  }

  async saveOwnerMapping(finId: string, account: string): Promise<OwnerMapping> {
    await this.finP2PContract.addCredential(finId, account);
    return { finId, account };
  }

  async deleteOwnerMapping(finId: string, _account?: string): Promise<void> {
    await this.finP2PContract.removeCredential(finId);
  }
}
