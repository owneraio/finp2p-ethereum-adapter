import { FireblocksSDK, TransactionStatus } from 'fireblocks-sdk';
import { setTimeout as sleep } from 'node:timers/promises';
import { createFireblocksEthersProvider, FireblocksAppConfig } from './fireblocks-config';
import { createVaultManagementFunctions } from '../../vaults';
import { CustodyProvider, CustodyWallet, GasStation } from './custody-provider';
import { FireblocksRawSigner } from './fireblocks-raw-signer';

export type DetectedDeposit = {
  txHash: string;
  fireblocksId: string;
  amount: string;
};

export class FireblocksCustodyProvider implements CustodyProvider {
  readonly issuer: CustodyWallet;
  readonly escrow: CustodyWallet;
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
  ) {
    this.issuer = issuer;
    this.escrow = escrow;
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

    const issuerVault = config.assetIssuerVaultId;
    const escrowVault = config.assetEscrowVaultId;

    let issuerWallet: CustodyWallet | undefined;
    let escrowWallet: CustodyWallet | undefined;
    if (issuerVault) issuerWallet = await createWallet(issuerVault);
    if (escrowVault) escrowWallet = await createWallet(escrowVault);

    // In standard mode, issuer and escrow are required
    if (!config.localSubmit && (!issuerWallet || !escrowWallet)) {
      throw new Error('FIREBLOCKS_ASSET_ISSUER_VAULT_ID and FIREBLOCKS_ASSET_ESCROW_VAULT_ID must be set');
    }

    let gasStation: GasStation | undefined;
    if (config.gasFunding) {
      const gasWallet = await createWallet(config.gasFunding.vaultId);
      gasStation = { wallet: gasWallet, amount: config.gasFunding.amount };
    }

    // In local submit mode, use a placeholder for unconfigured wallets.
    // Real wallets are resolved per-operation via createWalletForCustodyId.
    const placeholder: CustodyWallet = { provider: config.provider, signer: config.provider as any };
    return new FireblocksCustodyProvider(
      issuerWallet ?? placeholder, escrowWallet ?? placeholder,
      config, fireblocksSdk, vaultManagement, gasStation,
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

  async onAssetRegistered(tokenAddress: string, symbol?: string): Promise<void> {
    if (this.config.localSubmit) return;
    const responseRegister = await this.fireblocksSdk.registerNewAsset(
      'ETH_TEST5', tokenAddress, symbol
    );
    if (this.config.assetIssuerVaultId) {
      await this.fireblocksSdk.createVaultAsset(this.config.assetIssuerVaultId, responseRegister.legacyId);
    }
  }

  async fundDepositVault(vaultId: string): Promise<void> {
    if (!this.gasStation) return;
    if (!this.config.chainId) throw new Error('FIREBLOCKS_CHAIN_ID is required for fundDepositVault');
    const wallet = await createFireblocksEthersProvider({
      apiKey: this.config.apiKey,
      privateKey: this.config.apiPrivateKey,
      chainId: this.config.chainId,
      apiBaseUrl: this.config.apiBaseUrl!,
      vaultAccountIds: [vaultId],
    });
    try {
      const { parseEther } = await import('ethers');
      const targetAddress = await wallet.signer.getAddress();
      const tx = await this.gasStation.wallet.signer.sendTransaction({
        to: targetAddress,
        value: parseEther(this.gasStation.amount),
      });
      await tx.wait();

      const transactions = await this.fireblocksSdk.getTransactions({ txHash: tx.hash });
      if (!transactions || transactions.length === 0) {
        return;
      }

      const fireblocksId = transactions[0].id;
      const errorStatuses: TransactionStatus[] = [
        TransactionStatus.FAILED,
        TransactionStatus.BLOCKED,
        TransactionStatus.CANCELLED,
        TransactionStatus.REJECTED,
      ];

      while (true) {
        const txInfo = await this.fireblocksSdk.getTransactionById(fireblocksId);
        if (txInfo.status === TransactionStatus.COMPLETED) {
          return;
        } else if (errorStatuses.includes(txInfo.status)) {
          throw new Error(`Gas funding failed with status: ${txInfo.status}, id: ${fireblocksId}`);
        } else {
          await sleep(3000);
        }
      }
    } catch (e) {
      console.warn(`Gas funding failed (wallet may already have sufficient gas): ${e}`);
    }
  }

  async createDepositVault(name: string) {
    return this.vaultManagement.createVaultAccount(name);
  }

  async getDepositAddress(vaultId: string, contractAddress: string): Promise<{ walletAddress: string; legacyAssetId: string }> {
    // Attach base chain asset (ETH_TEST5) to the vault first
    try {
      await this.fireblocksSdk.createVaultAsset(vaultId, 'ETH_TEST5');
    } catch (e) {
      console.warn(`ETH_TEST5 vault asset creation failed (may already exist): ${e}`);
    }

    let legacyId: string;
    try {
      ({ legacyId } = await this.fireblocksSdk.registerNewAsset('ETH_TEST5', contractAddress));
    } catch (e) {
      console.warn(`Asset registration failed (may already exist): ${e}`);
      const asset = await this.vaultManagement.findAssetByContractAddress(contractAddress);
      if (!asset) {
        throw new Error(`Asset with contract address ${contractAddress} not found in Fireblocks`);
      }
      legacyId = asset.legacyId;
    }

    // Attach the token asset to the vault
    try {
      await this.fireblocksSdk.createVaultAsset(vaultId, legacyId);
    } catch (e) {
      console.warn(`Token vault asset creation failed (may already exist): ${e}`);
    }

    const addresses = await this.fireblocksSdk.getDepositAddresses(vaultId, legacyId);
    if (!addresses || addresses.length === 0) {
      throw new Error(`No deposit address available for vault ${vaultId}`);
    }
    return { walletAddress: addresses[0].address, legacyAssetId: legacyId };
  }

  startDepositMonitor(
    vaultId: string,
    legacyAssetId: string,
    onDeposit: (deposit: DetectedDeposit) => Promise<void>,
  ): void {
    const poll = async () => {
      while (true) {
        await sleep(10_000);
        try {
          const balance = await this.vaultManagement.getVaultAssetBalance(vaultId, legacyAssetId);
          const numBalance = Number(balance);
          if (balance && Number.isFinite(numBalance) && numBalance > 0) {
            console.log(`Deposit detected: vault=${vaultId}, asset=${legacyAssetId}, balance=${balance}`);
            const deposit = await this.fetchDepositTransaction(vaultId, legacyAssetId);
            await onDeposit(deposit);
            return;
          }
        } catch (e) {
          console.warn(`Deposit monitor poll failed for vault ${vaultId}, asset ${legacyAssetId}: ${e}`);
        }
      }
    };
    poll().catch(e => console.error(`Deposit monitor crashed for vault ${vaultId}: ${e}`));
  }

  async transferToVaultByAddress(fromVaultId: string, destinationAddress: string, legacyAssetId: string, amount: string, note?: string): Promise<void> {
    const destinationVaultId = await this.vaultManagement.getVaultIdForAddress(destinationAddress);
    if (!destinationVaultId) {
      throw new Error(`Cannot resolve vault ID for address ${destinationAddress}`);
    }
    await this.vaultManagement.transferAssetFromVaultToVault(fromVaultId, destinationVaultId, legacyAssetId, amount, note);
  }

  private async fetchDepositTransaction(vaultId: string, legacyAssetId: string): Promise<DetectedDeposit> {
    const txs = await this.fireblocksSdk.getTransactions({
      destId: vaultId,
      assets: legacyAssetId,
      status: TransactionStatus.COMPLETED,
      sort: 'DESC',
      limit: 1,
    });
    if (txs.length === 0) {
      console.error(`No completed transactions found for vault=${vaultId}, asset=${legacyAssetId} despite positive balance`);
      throw new Error(`No completed deposit transaction found for vault ${vaultId}, asset ${legacyAssetId}`);
    }
    const tx = txs[0];
    const amount = tx.amountInfo?.amount ?? tx.amount?.toString();
    if (!tx.txHash || !tx.id || !amount) {
      console.error(`Incomplete deposit transaction data: txHash=${tx.txHash}, fireblocksId=${tx.id}, amount=${amount}, vault=${vaultId}, asset=${legacyAssetId}`);
      throw new Error(`Incomplete deposit transaction data for vault ${vaultId}, asset ${legacyAssetId}`);
    }
    return { txHash: tx.txHash, fireblocksId: tx.id, amount };
  }
}
