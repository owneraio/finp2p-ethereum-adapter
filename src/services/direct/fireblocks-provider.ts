import { FireblocksSDK } from 'fireblocks-sdk';
import { createFireblocksEthersProvider, FireblocksAppConfig } from './fireblocks-config';
import { createVaultManagementFunctions } from '../../vaults';
import { CustodyProvider, CustodyWallet, GasStation } from './custody-provider';
import { FireblocksRawSigner } from './fireblocks-raw-signer';

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

    // Create wallets for configured vaults, falling back to omnibus
    const issuerVault = config.assetIssuerVaultId ?? config.omnibusVaultId;
    const escrowVault = config.assetEscrowVaultId ?? config.omnibusVaultId;

    let issuerWallet: CustodyWallet | undefined;
    let escrowWallet: CustodyWallet | undefined;
    if (issuerVault) issuerWallet = await createWallet(issuerVault);
    if (escrowVault) escrowWallet = await createWallet(escrowVault);

    // In standard mode, issuer and escrow are required
    if (!config.localSubmit && (!issuerWallet || !escrowWallet)) {
      throw new Error('Either FIREBLOCKS_ASSET_ISSUER_VAULT_ID/FIREBLOCKS_ASSET_ESCROW_VAULT_ID or FIREBLOCKS_OMNIBUS_VAULT_ID must be set');
    }

    let gasStation: GasStation | undefined;
    if (config.gasFunding) {
      const gasWallet = await createWallet(config.gasFunding.vaultId);
      gasStation = { wallet: gasWallet, amount: config.gasFunding.amount };
    }

    let omnibusWallet: CustodyWallet | undefined;
    if (config.omnibusVaultId) {
      omnibusWallet = await createWallet(config.omnibusVaultId);
    }

    // In local submit mode, use a placeholder for unconfigured wallets.
    // Real wallets are resolved per-operation via createWalletForCustodyId.
    const placeholder: CustodyWallet = { provider: config.provider, signer: config.provider as any };
    return new FireblocksCustodyProvider(
      issuerWallet ?? placeholder, escrowWallet ?? placeholder,
      config, fireblocksSdk, vaultManagement, gasStation, omnibusWallet
    );
  }

  async createWalletForCustodyId(vaultAccountId: string): Promise<CustodyWallet> {
    if (this.config.localSubmit) {
      const signer = new FireblocksRawSigner({
        fireblocksSdk: this.fireblocksSdk,
        vaultAccountId: vaultAccountId,
      }, this.config.provider);
      return { provider: this.config.provider, signer };
    }
    if (!this.config.chainId) throw new Error('FIREBLOCKS_CHAIN_ID is required when LOCAL_SUBMIT is not enabled');
    return createFireblocksEthersProvider({
      apiKey: this.config.apiKey,
      privateKey: this.config.apiPrivateKey,
      chainId: this.config.chainId,
      apiBaseUrl: this.config.apiBaseUrl!,
      vaultAccountIds: [vaultAccountId],
    });
  }

  async resolveWallet(address: string): Promise<CustodyWallet | undefined> {
    const vaultId = await this.vaultManagement.getVaultIdForAddress(address);
    if (vaultId === undefined) return undefined;
    return this.createWalletForCustodyId(vaultId);
  }

  async resolveAddressFromCustodyId(vaultAccountId: string): Promise<string> {
    const assetId = 'ETH_TEST5'; // TODO: make configurable
    const addresses = await this.fireblocksSdk.getDepositAddresses(vaultAccountId, assetId);
    if (addresses.length === 0) {
      throw new Error(`No deposit address found for vault ${vaultAccountId} asset ${assetId}`);
    }
    return addresses[0].address;
  }

  async onAssetRegistered(tokenAddress: string, symbol?: string): Promise<void> {
    if (this.config.localSubmit) return; // No Fireblocks asset registration on private networks
    const responseRegister = await this.fireblocksSdk.registerNewAsset(
      'ETH_TEST5', tokenAddress, symbol
    );
    const vaultId = this.config.assetIssuerVaultId ?? this.config.omnibusVaultId;
    if (vaultId) {
      await this.fireblocksSdk.createVaultAsset(vaultId, responseRegister.legacyId);
    }
  }
}
