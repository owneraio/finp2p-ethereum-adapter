import { DfnsApiClient } from '@dfns/sdk';
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner';
import { DfnsWallet } from '@dfns/lib-ethersjs6';
import { JsonRpcProvider } from 'ethers';
import { DfnsAppConfig } from '../../config';
import { CustodyProvider, CustodyRoleBindings, CustodyWallet, GasStation, withLocalSubmit } from './custody-provider';

export interface DfnsCustodyResult {
  provider: DfnsCustodyProvider;
  roles: CustodyRoleBindings<CustodyWallet>;
}

export class DfnsCustodyProvider implements CustodyProvider {
  readonly rpcProvider;
  readonly gasStation?: GasStation;

  private dfnsClient: DfnsApiClient;
  private addressToWalletId: Map<string, string>;
  private localSubmit: boolean;

  private constructor(
    private readonly config: DfnsAppConfig,
    dfnsClient: DfnsApiClient,
    addressToWalletId: Map<string, string>,
    gasStation?: GasStation,
  ) {
    this.localSubmit = config.localSubmit ?? false;
    this.rpcProvider = config.provider;
    this.dfnsClient = dfnsClient;
    this.addressToWalletId = addressToWalletId;
    this.gasStation = gasStation;
  }

  private static createDfnsClient(config: DfnsAppConfig): DfnsApiClient {
    const keySigner = new AsymmetricKeySigner({ credId: config.dfnsCredId, privateKey: config.dfnsPrivateKey });
    return new DfnsApiClient({ baseUrl: config.dfnsBaseUrl, orgId: config.dfnsOrgId, authToken: config.dfnsAuthToken, signer: keySigner });
  }

  private static async createWalletProvider(dfnsClient: DfnsApiClient, walletId: string, rpcUrl: string): Promise<CustodyWallet> {
    const provider = new JsonRpcProvider(rpcUrl);
    const dfnsWallet = await DfnsWallet.init({ walletId, dfnsClient });
    const signer = dfnsWallet.connect(provider);
    return { provider, signer };
  }

  static async create(config: DfnsAppConfig): Promise<DfnsCustodyResult> {
    const dfnsClient = DfnsCustodyProvider.createDfnsClient(config);
    const localSubmit = config.localSubmit ?? false;
    const wrap = (w: CustodyWallet) => localSubmit ? withLocalSubmit(w, config.provider) : w;

    const issuerWallet = wrap(await DfnsCustodyProvider.createWalletProvider(dfnsClient, config.assetIssuerWalletId, config.rpcUrl));
    const escrowWallet = wrap(await DfnsCustodyProvider.createWalletProvider(dfnsClient, config.assetEscrowWalletId, config.rpcUrl));

    // Cache address → walletId mapping
    const addressToWalletId = new Map<string, string>();
    const { items } = await dfnsClient.wallets.listWallets({});
    for (const w of items) {
      if (w.address) {
        addressToWalletId.set(w.address.toLowerCase(), w.id);
      }
    }

    let gasStation: GasStation | undefined;
    if (config.gasFunding) {
      const gasWallet = wrap(await DfnsCustodyProvider.createWalletProvider(dfnsClient, config.gasFunding.walletId, config.rpcUrl));
      gasStation = { wallet: gasWallet, amount: config.gasFunding.amount };
    }

    let omnibusWallet: CustodyWallet | undefined;
    if (config.omnibusWalletId) {
      omnibusWallet = wrap(await DfnsCustodyProvider.createWalletProvider(dfnsClient, config.omnibusWalletId, config.rpcUrl));
    }

    const roles: CustodyRoleBindings<CustodyWallet> = {
      issuer: issuerWallet,
      escrow: escrowWallet,
      ...(omnibusWallet ? { omnibus: omnibusWallet } : {}),
    };

    return {
      provider: new DfnsCustodyProvider(config, dfnsClient, addressToWalletId, gasStation),
      roles,
    };
  }

  async resolveWallet(address: string): Promise<CustodyWallet | undefined> {
    const walletId = this.addressToWalletId.get(address.toLowerCase());
    if (walletId === undefined) return undefined;
    const wallet = await DfnsCustodyProvider.createWalletProvider(this.dfnsClient, walletId, this.config.rpcUrl);
    return this.localSubmit ? withLocalSubmit(wallet, this.config.provider) : wallet;
  }
}
