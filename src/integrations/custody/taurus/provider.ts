import { JsonRpcProvider, Provider } from 'ethers';
import { CustodyProvider, CustodyWallet } from '../../../services/custody';
import { TaurusAppConfig } from './config';
import { TaurusClient } from './client';
import { TaurusSigner } from './signer';

/**
 * Taurus-PROTECT/TDX custody provider (PoC). Custody account id = PROTECT
 * address id; keys live in the Taurus HSM and transactions run as governed
 * requests (see signer.ts for the structured-request translation the missing
 * raw signing forces). Addresses are cached at boot like the DFNS provider.
 */
export class TaurusCustodyProvider implements CustodyProvider {

  private constructor(
    private readonly config: TaurusAppConfig,
    private readonly client: TaurusClient,
    private readonly rpcProvider: Provider,
    private readonly addressToId: Map<string, string>,
  ) {}

  static async create(config: TaurusAppConfig): Promise<TaurusCustodyProvider> {
    const client = new TaurusClient(config);
    const rpcProvider = new JsonRpcProvider(config.rpcUrl);
    const addressToId = new Map<string, string>();
    for (const a of await client.listAddresses()) {
      if (a.address) addressToId.set(a.address.toLowerCase(), a.id);
    }
    return new TaurusCustodyProvider(config, client, rpcProvider, addressToId);
  }

  async resolveWallet(account: string): Promise<CustodyWallet | undefined> {
    const addressId = this.addressToId.get(account.toLowerCase());
    if (!addressId) return undefined;
    return this.wallet(addressId, account);
  }

  async createWalletForCustodyId(custodyAccountId: string): Promise<CustodyWallet> {
    const address = await this.client.getAddress(custodyAccountId);
    return this.wallet(custodyAccountId, address.address);
  }

  async resolveAddressFromCustodyId(custodyAccountId: string): Promise<string> {
    const address = await this.client.getAddress(custodyAccountId);
    if (!address.address) throw new Error(`Taurus address ${custodyAccountId} has no chain address`);
    return address.address;
  }

  private wallet(addressId: string, address: string): CustodyWallet {
    return {
      provider: this.rpcProvider,
      signer: new TaurusSigner(this.rpcProvider, this.client, this.config, addressId, address),
    };
  }
}
