import { FireblocksSDK } from 'fireblocks-sdk';
import { createFireblocksEthersProvider, FireblocksAppConfig } from '../../config';
import { createVaultManagementFunctions } from '../../vaults';
import { CustodyProvider, CustodyRoleBindings, CustodyWallet, GasStation } from './custody-provider';
import { FireblocksRawSigner } from './fireblocks-raw-signer';

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
    const vaultManagement = createVaultManagementFunctions(fireblocksSdk);

    const createWallet = config.localSubmit
      ? (vaultId: string): CustodyWallet => {
          const signer = new FireblocksRawSigner({ fireblocksSdk, vaultAccountId: vaultId }, config.provider);
          return { provider: config.provider, signer };
        }
      : async (vaultId: string) => {
          if (!config.chainId) throw new Error('FIREBLOCKS_CHAIN_ID is required when LOCAL_SUBMIT is not enabled');
          return createFireblocksEthersProvider({
            apiKey: config.apiKey,
            privateKey: config.apiPrivateKey,
            chainId: config.chainId,
            apiBaseUrl: config.apiBaseUrl!,
            vaultAccountIds: [vaultId],
          });
        };

    const issuerWallet = await createWallet(config.assetIssuerVaultId);
    const escrowWallet = await createWallet(config.assetEscrowVaultId);

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

    if (this.config.localSubmit) {
      const signer = new FireblocksRawSigner({
        fireblocksSdk: this.fireblocksSdk,
        vaultAccountId: vaultId,
      }, this.config.provider);
      return { provider: this.config.provider, signer };
    }

    if (!this.config.chainId) throw new Error('FIREBLOCKS_CHAIN_ID is required when LOCAL_SUBMIT is not enabled');
    return createFireblocksEthersProvider({
      apiKey: this.config.apiKey,
      privateKey: this.config.apiPrivateKey,
      chainId: this.config.chainId,
      apiBaseUrl: this.config.apiBaseUrl!,
      vaultAccountIds: [vaultId],
    });
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
