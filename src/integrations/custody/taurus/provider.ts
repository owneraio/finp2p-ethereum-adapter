import { CustodyProvider, CustodyWallet } from '../../../services/custody';
import { TaurusAppConfig } from './config';
import { TaurusClient } from './client';
import { TaurusSigner } from './signers/base';
import { TaurusContractCallSigner } from './signers/contract-call';
import { TaurusTransferOnlySigner } from './signers/transfer-only';
import { TaurusChainProvider } from './chain-provider';

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
    readonly readProvider: TaurusChainProvider,
    private readonly addressToId: Map<string, string>,
  ) {}

  static async create(config: TaurusAppConfig): Promise<TaurusCustodyProvider> {
    const client = new TaurusClient(config);
    const readProvider = new TaurusChainProvider(client, await client.getChainId());
    const addressToId = new Map<string, string>();
    for (const a of await client.listAddresses()) {
      if (a.address) addressToId.set(a.address.toLowerCase(), a.id);
    }
    return new TaurusCustodyProvider(config, client, readProvider, addressToId);
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
    const signer: TaurusSigner = this.config.operationMode === 'contract-call'
      ? new TaurusContractCallSigner(this.readProvider, this.client, this.config, addressId, address)
      : new TaurusTransferOnlySigner(this.readProvider, this.client, this.config, addressId, address);
    return { provider: this.readProvider, signer };
  }
}
