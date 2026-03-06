import { finIdToAddress } from '@owneraio/finp2p-contracts';

export interface AccountMappingService {
  resolveAccount(finId: string): Promise<string | undefined>;
  resolveFinId(account: string): Promise<string | undefined>;
}

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
