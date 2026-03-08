import { DfnsApiClient } from '@dfns/sdk';
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner';
import { DfnsWallet } from '@dfns/lib-ethersjs6';
import { JsonRpcProvider } from 'ethers';
import { DfnsAppConfig } from '../../config';
import { CustodyProvider, CustodyWallet, GasStation } from './custody-provider';

export class DfnsCustodyProvider implements CustodyProvider {
  readonly issuer: CustodyWallet;
  readonly escrow: CustodyWallet;
  readonly healthCheckProvider;
  readonly gasStation?: GasStation;

  private dfnsClient: DfnsApiClient;
  private addressToWalletId: Map<string, string>;

  private constructor(
    issuer: CustodyWallet,
    escrow: CustodyWallet,
    private readonly config: DfnsAppConfig,
    dfnsClient: DfnsApiClient,
    addressToWalletId: Map<string, string>,
    gasStation?: GasStation,
  ) {
    this.issuer = issuer;
    this.escrow = escrow;
    this.healthCheckProvider = config.provider;
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

  static async create(config: DfnsAppConfig): Promise<DfnsCustodyProvider> {
    const dfnsClient = DfnsCustodyProvider.createDfnsClient(config);

    const issuerWallet = await DfnsCustodyProvider.createWalletProvider(dfnsClient, config.assetIssuerWalletId, config.rpcUrl);
    const escrowWallet = await DfnsCustodyProvider.createWalletProvider(dfnsClient, config.assetEscrowWalletId, config.rpcUrl);

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
      const gasWallet = await DfnsCustodyProvider.createWalletProvider(dfnsClient, config.gasFunding.walletId, config.rpcUrl);
      gasStation = { wallet: gasWallet, amount: config.gasFunding.amount };
    }

    return new DfnsCustodyProvider(issuerWallet, escrowWallet, config, dfnsClient, addressToWalletId, gasStation);
  }

  async resolveWallet(address: string): Promise<CustodyWallet | undefined> {
    const walletId = this.addressToWalletId.get(address.toLowerCase());
    if (walletId === undefined) return undefined;
    return DfnsCustodyProvider.createWalletProvider(this.dfnsClient, walletId, this.config.rpcUrl);
  }
}
