import { FireblocksSDK } from 'fireblocks-sdk';
import { createFireblocksEthersProvider, FireblocksAppConfig } from '../../config';
import { createVaultManagementFunctions } from '../../vaults';
import { CustodyProvider, CustodyWallet, GasStation, withLocalSubmit } from './custody-provider';

export class FireblocksCustodyProvider implements CustodyProvider {
  readonly issuer: CustodyWallet;
  readonly escrow: CustodyWallet;
  readonly omnibus?: CustodyWallet;
  readonly rpcProvider;
  readonly gasStation?: GasStation;

  private fireblocksSdk: FireblocksSDK;
  private vaultManagement: ReturnType<typeof createVaultManagementFunctions>;
  private localSubmit: boolean;

  private constructor(
    issuer: CustodyWallet,
    escrow: CustodyWallet,
    private readonly config: FireblocksAppConfig,
    fireblocksSdk: FireblocksSDK,
    vaultManagement: ReturnType<typeof createVaultManagementFunctions>,
    gasStation?: GasStation,
    omnibus?: CustodyWallet,
  ) {
    this.localSubmit = config.localSubmit ?? false;
    const wrap = (w: CustodyWallet) => this.localSubmit ? withLocalSubmit(w, config.provider) : w;
    this.issuer = wrap(issuer);
    this.escrow = wrap(escrow);
    this.omnibus = omnibus ? wrap(omnibus) : undefined;
    this.rpcProvider = config.provider;
    this.fireblocksSdk = fireblocksSdk;
    this.vaultManagement = vaultManagement;
    this.gasStation = gasStation ? { wallet: wrap(gasStation.wallet), amount: gasStation.amount } : undefined;
  }

  static async create(config: FireblocksAppConfig): Promise<FireblocksCustodyProvider> {
    const createProvider = (vaultId: string) => createFireblocksEthersProvider({
      apiKey: config.apiKey,
      privateKey: config.apiPrivateKey,
      chainId: config.chainId,
      apiBaseUrl: config.apiBaseUrl,
      vaultAccountIds: [vaultId],
    });

    const issuerWallet = await createProvider(config.assetIssuerVaultId);
    const escrowWallet = await createProvider(config.assetEscrowVaultId);

    const fireblocksSdk = new FireblocksSDK(config.apiPrivateKey, config.apiKey, config.apiBaseUrl as string);
    const vaultManagement = createVaultManagementFunctions(fireblocksSdk);

    let gasStation: GasStation | undefined;
    if (config.gasFunding) {
      const gasWallet = await createProvider(config.gasFunding.vaultId);
      gasStation = { wallet: gasWallet, amount: config.gasFunding.amount };
    }

    let omnibusWallet: CustodyWallet | undefined;
    if (config.omnibusVaultId) {
      omnibusWallet = await createProvider(config.omnibusVaultId);
    }

    return new FireblocksCustodyProvider(
      issuerWallet, escrowWallet,
      config, fireblocksSdk, vaultManagement, gasStation, omnibusWallet
    );
  }

  async resolveWallet(address: string): Promise<CustodyWallet | undefined> {
    const vaultId = await this.vaultManagement.getVaultIdForAddress(address);
    if (vaultId === undefined) return undefined;

    const wallet = await createFireblocksEthersProvider({
      apiKey: this.config.apiKey,
      privateKey: this.config.apiPrivateKey,
      chainId: this.config.chainId,
      apiBaseUrl: this.config.apiBaseUrl,
      vaultAccountIds: [vaultId],
    });
    return this.localSubmit ? withLocalSubmit(wallet, this.config.provider) : wallet;
  }

  async onAssetRegistered(tokenAddress: string, symbol?: string): Promise<void> {
    const responseRegister = await this.fireblocksSdk.registerNewAsset(
      'ETH_TEST5', tokenAddress, symbol
    );
    await this.fireblocksSdk.createVaultAsset(
      this.config.assetIssuerVaultId, responseRegister.legacyId
    );
  }
}
