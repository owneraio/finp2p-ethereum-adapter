import { FireblocksSDK, TransactionStatus } from 'fireblocks-sdk';
import { parseEther } from 'ethers';
import { setTimeout as sleep } from 'node:timers/promises';
import { createFireblocksEthersProvider, FireblocksAppConfig } from './config';
import { createVaultManagementFunctions } from '../../vaults';
import { CustodyProvider, CustodyWallet, GasStation } from '../../services/direct';
import { FireblocksRawSigner } from './raw-signer';

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

    const fireblocksAssetId = process.env.FIREBLOCKS_ASSET_ID ?? 'ETH_TEST5';

    const createWallet = config.localSubmit
      ? (vaultId: string): CustodyWallet => {
          const signer = new FireblocksRawSigner({ fireblocksSdk, vaultAccountId: vaultId, assetId: fireblocksAssetId }, config.provider);
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
      const assetId = process.env.FIREBLOCKS_ASSET_ID ?? 'ETH_TEST5';
      const signer = new FireblocksRawSigner({
        fireblocksSdk: this.fireblocksSdk,
        vaultAccountId: vaultAccountId,
        assetId,
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
    const assetId = process.env.FIREBLOCKS_ASSET_ID ?? 'ETH_TEST5';
    const addresses = await this.fireblocksSdk.getDepositAddresses(vaultAccountId, assetId);
    if (addresses.length === 0) {
      throw new Error(`No deposit address found for vault ${vaultAccountId} asset ${assetId}`);
    }
    return addresses[0].address;
  }

  async fundGasIfNeeded(wallet: CustodyWallet): Promise<void> {
    if (!this.gasStation) return;
    try {
      const targetAddress = await wallet.signer.getAddress();
      const tx = await this.gasStation.wallet.signer.sendTransaction({
        to: targetAddress,
        value: parseEther(this.gasStation.amount),
      });
      await tx.wait();

      const transactions = await this.fireblocksSdk.getTransactions({ txHash: tx.hash });
      if (!transactions || transactions.length === 0) return;

      const fireblocksId = transactions[0].id;
      const errorStatuses: TransactionStatus[] = [
        TransactionStatus.FAILED,
        TransactionStatus.BLOCKED,
        TransactionStatus.CANCELLED,
        TransactionStatus.REJECTED,
      ];

      while (true) {
        const txInfo = await this.fireblocksSdk.getTransactionById(fireblocksId);
        if (txInfo.status === TransactionStatus.COMPLETED) return;
        if (errorStatuses.includes(txInfo.status)) {
          throw new Error(`Gas funding failed with status: ${txInfo.status}, id: ${fireblocksId}`);
        }
        await sleep(3000);
      }
    } catch (e) {
      console.warn(`Gas funding failed (wallet may already have sufficient gas): ${e}`);
    }
  }

  async onAssetRegistered(tokenAddress: string, symbol?: string): Promise<void> {
    if (this.config.localSubmit) return;
    const responseRegister = await this.fireblocksSdk.registerNewAsset(
      'ETH_TEST5', tokenAddress, symbol
    );
    const vaultId = this.config.assetIssuerVaultId ?? this.config.omnibusVaultId;
    if (vaultId) {
      await this.fireblocksSdk.createVaultAsset(vaultId, responseRegister.legacyId);
    }
  }
}
