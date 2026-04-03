import { JsonRpcProvider } from 'ethers';
import { FireblocksSDK } from 'fireblocks-sdk';
import { createFireblocksCustodyWallet, FireblocksAppConfig } from './fireblocks-config';
import { createVaultManagementFunctions } from '../../vaults';
import { CustodyProvider, CustodyWallet, GasStation } from './custody-provider';

export class FireblocksCustodyProvider implements CustodyProvider {
  readonly issuer: CustodyWallet;
  readonly escrow: CustodyWallet;
  readonly omnibus?: CustodyWallet;
  readonly rpcProvider;
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
    omnibus?: CustodyWallet,
  ) {
    this.issuer = issuer;
    this.escrow = escrow;
    this.omnibus = omnibus;
    this.rpcProvider = config.provider;
    this.fireblocksSdk = fireblocksSdk;
    this.vaultManagement = vaultManagement;
    this.gasStation = gasStation;
  }

  static async create(config: FireblocksAppConfig): Promise<FireblocksCustodyProvider> {
    const fireblocksSdk = new FireblocksSDK(config.apiPrivateKey, config.apiKey, config.apiBaseUrl as string);
    const rpcProvider = config.provider as JsonRpcProvider;

    const createWallet = (vaultId: string) => createFireblocksCustodyWallet({
      fireblocksSdk, vaultAccountId: vaultId, fireblocksAssetId: config.fireblocksAssetId, rpcProvider,
    });

    const issuerWallet = await createWallet(config.assetIssuerVaultId);
    const escrowWallet = await createWallet(config.assetEscrowVaultId);

    const vaultManagement = createVaultManagementFunctions(fireblocksSdk);

    let gasStation: GasStation | undefined;
    if (config.gasFunding) {
      const gasWallet = await createWallet(config.gasFunding.vaultId);
      gasStation = { wallet: gasWallet, amount: config.gasFunding.amount };
    }

    let omnibusWallet: CustodyWallet | undefined;
    if (config.omnibusVaultId) {
      omnibusWallet = await createWallet(config.omnibusVaultId);
    }

    return new FireblocksCustodyProvider(
      issuerWallet, escrowWallet,
      config, fireblocksSdk, vaultManagement, gasStation, omnibusWallet
    );
  }

  async resolveWallet(address: string): Promise<CustodyWallet | undefined> {
    const vaultId = await this.vaultManagement.getVaultIdForAddress(address);
    if (vaultId === undefined) return undefined;

    return createFireblocksCustodyWallet({
      fireblocksSdk: this.fireblocksSdk,
      vaultAccountId: vaultId,
      fireblocksAssetId: this.config.fireblocksAssetId,
      rpcProvider: this.config.provider as JsonRpcProvider,
    });
  }

  async resolveAddressFromCustodyId(vaultAccountId: string): Promise<string> {
    const addresses = await this.fireblocksSdk.getDepositAddresses(vaultAccountId, this.config.fireblocksAssetId);
    if (addresses.length === 0) {
      throw new Error(`No deposit address found for vault ${vaultAccountId} asset ${this.config.fireblocksAssetId}`);
    }
    return addresses[0].address;
  }

  async onAssetRegistered(tokenAddress: string, symbol?: string): Promise<void> {
    const responseRegister = await this.fireblocksSdk.registerNewAsset(
      this.config.fireblocksAssetId, tokenAddress, symbol
    );
    await this.fireblocksSdk.createVaultAsset(
      this.config.assetIssuerVaultId, responseRegister.legacyId
    );
  }
}
