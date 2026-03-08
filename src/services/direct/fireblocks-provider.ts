import { FireblocksSDK, TransactionStatus } from 'fireblocks-sdk';
import { parseEther } from 'ethers';
import { setTimeout as sleep } from 'node:timers/promises';
import { createFireblocksEthersProvider, FireblocksAppConfig } from '../../config';
import { createVaultManagementFunctions } from '../../vaults';
import { CustodyProvider, CustodyWallet, GasStation } from './custody-provider';

export class FireblocksCustodyProvider implements CustodyProvider {
  readonly issuer: CustodyWallet;
  readonly escrow: CustodyWallet;
  readonly healthCheckProvider;
  private readonly gasStation?: GasStation;

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

  async resolveWallet(address: string): Promise<CustodyWallet | undefined> {
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

  async onAssetRegistered(tokenAddress: string, symbol?: string): Promise<void> {
    const responseRegister = await this.fireblocksSdk.registerNewAsset(
      'ETH_TEST5', tokenAddress, symbol
    );
    await this.fireblocksSdk.createVaultAsset(
      this.config.assetIssuerVaultId, responseRegister.legacyId
    );
  }
}
