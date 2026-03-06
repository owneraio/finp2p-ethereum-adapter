import { FireblocksSDK } from 'fireblocks-sdk';
import { createFireblocksEthersProvider, FireblocksAppConfig } from '../../config';
import { createVaultManagementFunctions } from '../../vaults';
import { CustodyProvider, CustodyWallet, GasStation } from './custody-provider';

export class FireblocksCustodyProvider implements CustodyProvider {
  readonly issuer: CustodyWallet;
  readonly escrow: CustodyWallet;
  readonly healthCheckProvider;
  readonly gasStation?: GasStation;

  private fireblocksSdk: FireblocksSDK;
  private vaultManagement: ReturnType<typeof createVaultManagementFunctions>;

  private constructor(
    issuer: CustodyWallet,
    escrow: CustodyWallet,
    private readonly config: FireblocksAppConfig,
    fireblocksSdk: FireblocksSDK,
    vaultManagement: ReturnType<typeof createVaultManagementFunctions>,
    gasStation?: GasStation,
  ) {
    this.issuer = issuer;
    this.escrow = escrow;
    this.healthCheckProvider = config.provider;
    this.fireblocksSdk = fireblocksSdk;
    this.vaultManagement = vaultManagement;
    this.gasStation = gasStation;
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

    return new FireblocksCustodyProvider(
      issuerWallet, escrowWallet,
      config, fireblocksSdk, vaultManagement, gasStation
    );
  }

  async resolveWalletForAddress(address: string): Promise<CustodyWallet | undefined> {
    const vaultId = await this.vaultManagement.getVaultIdForAddress(address);
    if (vaultId === undefined) return undefined;

    return createFireblocksEthersProvider({
      apiKey: this.config.apiKey,
      privateKey: this.config.apiPrivateKey,
      chainId: this.config.chainId,
      apiBaseUrl: this.config.apiBaseUrl,
      vaultAccountIds: [vaultId],
    });
  }

  async transferBetweenVaults(fromVaultId: string, toVaultId: string, assetId: string, amount: string): Promise<void> {
    await this.vaultManagement.transferAssetFromVaultToVault(this.fireblocksSdk, fromVaultId, toVaultId, assetId, amount);
  }

  async getVaultIdForAddress(address: string): Promise<string | undefined> {
    return this.vaultManagement.getVaultIdForAddress(address);
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
