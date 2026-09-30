import { JsonRpcProvider, Provider } from 'ethers';
import { CustodyProvider, CustodyWallet } from '../../../services/custody';
import { ZodiaClient } from './client';
import { ZODIA_NATIVE_BY_CHAIN_ID, ZodiaAppConfig, ZodiaCurrencyRef } from './config';
import { ZodiaApi, ZodiaSigner, ZodiaWallets } from './signer';

/**
 * Zodia Custody provider (PoC). Custody account id = Zodia wallet id; keys
 * live in Zodia's HSM and value moves as governed Service Desk transfers (see
 * signer.ts). Addresses are cached at boot like the DFNS provider. Wallet
 * creation is a service request an authoriser must approve, so this provider
 * does not create custody accounts; they are made in Zodia and referenced by id.
 */
export class ZodiaCustodyProvider implements CustodyProvider, ZodiaWallets {

  private constructor(
    private readonly config: ZodiaAppConfig,
    private readonly api: ZodiaApi,
    private readonly rpcProvider: Provider,
    readonly native: ZodiaCurrencyRef,
    private readonly addressToWallet: Map<string, string>,
    private readonly walletToAddress: Map<string, string>,
  ) {}

  static async create(config: ZodiaAppConfig, api: ZodiaApi = new ZodiaClient(config)): Promise<ZodiaCustodyProvider> {
    const rpcProvider = new JsonRpcProvider(config.rpcUrl);
    const native = config.native ?? await nativeOf(rpcProvider);
    const addressToWallet = new Map<string, string>();
    const walletToAddress = new Map<string, string>();
    for (const a of await api.addresses({ currenciesIds: [native.currencyId] })) {
      addressToWallet.set(a.address.toLowerCase(), a.walletId);
      if (!walletToAddress.has(a.walletId)) walletToAddress.set(a.walletId, a.address);
    }
    return new ZodiaCustodyProvider(config, api, rpcProvider, native, addressToWallet, walletToAddress);
  }

  async walletIdOf(address: string): Promise<string | undefined> {
    return this.addressToWallet.get(address.toLowerCase());
  }

  async resolveWallet(account: string): Promise<CustodyWallet | undefined> {
    const walletId = this.addressToWallet.get(account.toLowerCase());
    if (!walletId) return undefined;
    return this.wallet(walletId, account);
  }

  async createWalletForCustodyId(custodyAccountId: string): Promise<CustodyWallet> {
    return this.wallet(custodyAccountId, await this.resolveAddressFromCustodyId(custodyAccountId));
  }

  async resolveAddressFromCustodyId(custodyAccountId: string): Promise<string> {
    const cached = this.walletToAddress.get(custodyAccountId);
    if (cached) return cached;
    const [found] = await this.api.addresses({ walletIds: [custodyAccountId], currenciesIds: [this.native.currencyId] });
    if (!found) throw new Error(`Zodia wallet ${custodyAccountId} has no ${this.native.currencyId} address`);
    this.walletToAddress.set(custodyAccountId, found.address);
    this.addressToWallet.set(found.address.toLowerCase(), custodyAccountId);
    return found.address;
  }

  private wallet(walletId: string, address: string): CustodyWallet {
    return {
      provider: this.rpcProvider,
      signer: new ZodiaSigner(this.rpcProvider, this.api, this.config, this, walletId, address),
    };
  }
}

async function nativeOf(provider: Provider): Promise<ZodiaCurrencyRef> {
  const chainId = (await provider.getNetwork()).chainId.toString();
  const native = ZODIA_NATIVE_BY_CHAIN_ID[chainId];
  if (!native) throw new Error(`No Zodia currency known for chain ${chainId}; set ZODIA_NATIVE_CURRENCY to CODE:currency-id`);
  return native;
}
