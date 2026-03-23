import { FireblocksSDK, TransactionStatus } from 'fireblocks-sdk';
import { parseEther } from 'ethers';
import { setTimeout as sleep } from 'node:timers/promises';
import winston from 'winston';
import { createFireblocksEthersProvider, FireblocksAppConfig } from '../../config';
import { createVaultManagementFunctions } from '../../vaults';
import { CustodyProvider, CustodyWallet, GasStation } from './custody-provider';

export type DetectedDeposit = {
  txHash: string;
  fireblocksId: string;
  amount: string;
};

export class FireblocksCustodyProvider implements CustodyProvider {
  readonly issuer: CustodyWallet;
  readonly escrow: CustodyWallet;
  readonly omnibus?: CustodyWallet;
  readonly rpcProvider;
  readonly gasStation?: GasStation;

  private fireblocksSdk: FireblocksSDK;
  private vaultManagement: ReturnType<typeof createVaultManagementFunctions>;
  private readonly logger: winston.Logger;

  private constructor(
    issuer: CustodyWallet,
    escrow: CustodyWallet,
    private readonly config: FireblocksAppConfig,
    fireblocksSdk: FireblocksSDK,
    vaultManagement: ReturnType<typeof createVaultManagementFunctions>,
    logger: winston.Logger,
    gasStation?: GasStation,
    omnibus?: CustodyWallet,
  ) {
    this.issuer = issuer;
    this.escrow = escrow;
    this.omnibus = omnibus;
    this.rpcProvider = config.provider;
    this.fireblocksSdk = fireblocksSdk;
    this.vaultManagement = vaultManagement;
    this.logger = logger;
    this.gasStation = gasStation;
  }

  static async create(config: FireblocksAppConfig, logger: winston.Logger): Promise<FireblocksCustodyProvider> {
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
      config, fireblocksSdk, vaultManagement, logger, gasStation, omnibusWallet
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

  async createDepositVault(name: string) {
    return this.vaultManagement.createVaultAccount(name);
  }

  async getDepositAddress(vaultId: string, contractAddress: string): Promise<{ walletAddress: string; legacyAssetId: string }> {
    // Attach base chain asset (ETH_TEST5) to the vault first
    try {
      await this.fireblocksSdk.createVaultAsset(vaultId, 'ETH_TEST5');
    } catch (e) {
      this.logger.warn(`ETH_TEST5 vault asset creation failed (may already exist): ${e}`);
    }

    let legacyId: string;
    try {
      ({ legacyId } = await this.fireblocksSdk.registerNewAsset('ETH_TEST5', contractAddress));
    } catch (e) {
      this.logger.warn(`Asset registration failed (may already exist): ${e}`);
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
      this.logger.warn(`Token vault asset creation failed (may already exist): ${e}`);
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
            this.logger.info(`Deposit detected: vault=${vaultId}, asset=${legacyAssetId}, balance=${balance}`);
            const deposit = await this.fetchDepositTransaction(vaultId, legacyAssetId);
            await onDeposit(deposit);
            return;
          }
        } catch (e) {
          this.logger.warn(`Deposit monitor poll failed for vault ${vaultId}, asset ${legacyAssetId}: ${e}`);
        }
      }
    };
    poll().catch(e => this.logger.error(`Deposit monitor crashed for vault ${vaultId}: ${e}`));
  }

  async transferToOmnibus(fromVaultId: string, legacyAssetId: string, amount: string, note?: string): Promise<void> {
    if (!this.config.omnibusVaultId) {
      throw new Error('Omnibus vault ID is not configured');
    }
    this.logger.info(`Transferring ${amount} of asset ${legacyAssetId} from vault ${fromVaultId} to omnibus vault ${this.config.omnibusVaultId}`);
    await this.vaultManagement.transferAssetFromVaultToVault(fromVaultId, this.config.omnibusVaultId, legacyAssetId, amount, note);
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
      this.logger.error(`No completed transactions found for vault=${vaultId}, asset=${legacyAssetId} despite positive balance`);
      throw new Error(`No completed deposit transaction found for vault ${vaultId}, asset ${legacyAssetId}`);
    }
    const tx = txs[0];
    const amount = tx.amountInfo?.amount ?? tx.amount?.toString();
    if (!tx.txHash || !tx.id || !amount) {
      this.logger.error(`Incomplete deposit transaction data: txHash=${tx.txHash}, fireblocksId=${tx.id}, amount=${amount}, vault=${vaultId}, asset=${legacyAssetId}`);
      throw new Error(`Incomplete deposit transaction data for vault ${vaultId}, asset ${legacyAssetId}`);
    }
    return { txHash: tx.txHash, fireblocksId: tx.id, amount };
  }
}
