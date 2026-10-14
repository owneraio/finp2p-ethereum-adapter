import { JsonRpcProvider, Provider } from 'ethers';
import { CustodyProvider, CustodyWallet } from '../../../services/custody';
import { ChainReadScope } from '../../../services/custody/custody-provider';
import { getNetworkRpcUrl } from '../../../network-host';
import { ZodiaClient } from './client';
import { ZODIA_NATIVE_BY_CHAIN_ID, ZodiaAppConfig, ZodiaCurrencyRef, chainIdOfNative } from './config';
import { ZodiaChainProvider } from './chain-provider';
import { ZodiaApi, ZodiaSigner, ZodiaWallets } from './signer';

/**
 * Zodia Custody provider. Custody account id = Zodia wallet id; keys live in
 * Zodia's HSM and value moves as governed Service Desk transfers (see
 * signer.ts). Addresses are cached at boot. Wallet creation is a service
 * request an authoriser must approve, so this provider does not create
 * custody accounts; they are made in Zodia and referenced by id.
 *
 * Chain reads go through NETWORK_HOST when it is set, checked to be the chain
 * of Zodia's native currency; otherwise Zodia serves them itself, which covers
 * ERC20 only (see chain-provider.ts).
 */
export class ZodiaCustodyProvider implements CustodyProvider, ZodiaWallets {

  private decimalsByCurrencyId: Map<string, number> | undefined;
  private chainReadsValue!: { provider: Provider; scope: ChainReadScope };

  private constructor(
    private readonly config: ZodiaAppConfig,
    private readonly api: ZodiaApi,
    readonly native: ZodiaCurrencyRef,
    private readonly addressToWallet: Map<string, string>,
    private readonly walletToAddress: Map<string, string>,
  ) {}

  get chainReads(): { provider: Provider; scope: ChainReadScope } {
    return this.chainReadsValue;
  }

  static async create(config: ZodiaAppConfig, api: ZodiaApi = new ZodiaClient(config)): Promise<ZodiaCustodyProvider> {
    const rpc = process.env.NETWORK_HOST ? new JsonRpcProvider(getNetworkRpcUrl()) : undefined;
    const native = config.native ?? (rpc ? await nativeOfRpc(rpc) : await nativeOfWallets(api));
    const chainId = chainIdOfNative(native);

    const addressToWallet = new Map<string, string>();
    const walletToAddress = new Map<string, string>();
    for (const a of await api.addresses({ currenciesIds: [native.currencyId] })) {
      addressToWallet.set(a.address.toLowerCase(), a.walletId);
      if (!walletToAddress.has(a.walletId)) walletToAddress.set(a.walletId, a.address);
    }
    const provider = new ZodiaCustodyProvider(config, api, native, addressToWallet, walletToAddress);

    if (rpc) {
      const rpcChainId = (await rpc.getNetwork()).chainId;
      if (chainId !== undefined && rpcChainId !== chainId) {
        rpc.destroy();
        throw new Error(`NETWORK_HOST is on chain ${rpcChainId}, but Zodia currency ${native.currencyId} is chain ${chainId}`);
      }
      provider.chainReadsValue = { provider: rpc, scope: 'full' };
    } else {
      if (chainId === undefined) {
        throw new Error(`No chain id is known for Zodia currency ${native.currencyId}; set NETWORK_HOST so the chain can be read from it`);
      }
      provider.chainReadsValue = {
        provider: new ZodiaChainProvider(api, chainId, native, config.tokens, a => provider.walletIdOf(a), c => provider.decimalsOf(c)),
        scope: 'erc20',
      };
    }
    return provider;
  }

  async walletIdOf(address: string): Promise<string | undefined> {
    return this.addressToWallet.get(address.toLowerCase());
  }

  /** Zodia counts in the smallest unit; its currency list gives the ratio, 10^decimals. Listed once and kept. */
  async decimalsOf(currency: ZodiaCurrencyRef): Promise<number | undefined> {
    if (!this.decimalsByCurrencyId) {
      const known = new Map<string, number>();
      for (const c of await this.api.currencies()) {
        const places = Math.round(Math.log10(Number(c.ratio)));
        if (Number.isFinite(places) && places >= 0) known.set(c.currencyId, places);
      }
      this.decimalsByCurrencyId = known;
    }
    return this.decimalsByCurrencyId.get(currency.currencyId);
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
    const { provider } = this.chainReads;
    return { provider, signer: new ZodiaSigner(provider, this.api, this.config, this, walletId, address) };
  }
}

async function nativeOfRpc(provider: Provider): Promise<ZodiaCurrencyRef> {
  const chainId = (await provider.getNetwork()).chainId.toString();
  const native = ZODIA_NATIVE_BY_CHAIN_ID[chainId];
  if (!native) throw new Error(`No Zodia currency is known for chain ${chainId}; set ZODIA_NATIVE_CURRENCY to CODE:currency-id`);
  return native;
}

/** Without an RPC, the chain is the one the company's active EVM wallets are on. */
async function nativeOfWallets(api: ZodiaApi): Promise<ZodiaCurrencyRef> {
  const known = Object.values(ZODIA_NATIVE_BY_CHAIN_ID);
  const held = new Map<string, ZodiaCurrencyRef>();
  for (const w of await api.wallets({ currenciesIds: known.map(n => n.currencyId), statuses: ['ACTIVE'] })) {
    const native = known.find(n => n.currencyId === w.currencyId);
    if (native) held.set(native.currencyId, native);
  }
  if (held.size === 1) return [...held.values()][0];
  const found = held.size ? `wallets on ${[...held.keys()].join(' and ')}` : 'no wallet on a known EVM chain';
  throw new Error(`The Zodia company has ${found}; set ZODIA_NATIVE_CURRENCY to CODE:currency-id (e.g. eth:eth-Seth for Sepolia)`);
}
