import { JsonRpcProvider } from 'ethers';
import { FireblocksSDK } from 'fireblocks-sdk';
import { createFireblocksCustodyWallet, FireblocksAppConfig } from './fireblocks-config';
import { createVaultManagementFunctions } from '../../vaults';
import { CustodyProvider, CustodyRoleBindings, CustodyWallet, GasStation } from './custody-provider';

export interface FireblocksCustodyResult {
  provider: FireblocksCustodyProvider;
  roles: CustodyRoleBindings<CustodyWallet>;
}

export class FireblocksCustodyProvider implements CustodyProvider {
  readonly rpcProvider;
  readonly gasStation?: GasStation;

  private fireblocksSdk: FireblocksSDK;
  private vaultManagement: ReturnType<typeof createVaultManagementFunctions>;

  private constructor(
    private readonly config: FireblocksAppConfig,
    fireblocksSdk: FireblocksSDK,
    vaultManagement: ReturnType<typeof createVaultManagementFunctions>,
    gasStation?: GasStation,
  ) {
    this.rpcProvider = config.provider;
    this.fireblocksSdk = fireblocksSdk;
    this.vaultManagement = vaultManagement;
    this.gasStation = gasStation;
  }

  static async create(config: FireblocksAppConfig): Promise<FireblocksCustodyResult> {
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

    const roles: CustodyRoleBindings<CustodyWallet> = {
      issuer: issuerWallet,
      escrow: escrowWallet,
      ...(omnibusWallet ? { omnibus: omnibusWallet } : {}),
    };

    return {
      provider: new FireblocksCustodyProvider(config, fireblocksSdk, vaultManagement, gasStation),
      roles,
    };
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
