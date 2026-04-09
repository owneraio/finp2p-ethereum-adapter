import {
  PaymentService,
  DepositAsset,
  DepositOperation,
  Asset,
  AssetType,
  ReceiptOperation,
  Destination,
  Source,
  Signature,
  successfulDepositOperation,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { FireblocksAppConfig } from './fireblocks-config';
import { getAssetFromDb } from './helpers';
import { CustodyProvider } from './custody-provider';
import { DetectedDeposit, FireblocksCustodyProvider } from './fireblocks-provider';
import { DistributionService } from '@owneraio/finp2p-vanilla-service'

type DepositEntry = {
  correlationId: string;
  finId: string;
  assetId: string;
  assetType: AssetType;
  walletAddress: string;
  vaultId: string;
  contractAddress: string;
  asset: DepositAsset;
};

export class DirectPaymentsServiceImpl implements PaymentService {

  private readonly distributionService: DistributionService;
  private readonly appConfig: FireblocksAppConfig;
  private readonly fireblocksProvider: FireblocksCustodyProvider;
  private readonly finP2PClient: FinP2PClient;
  private readonly depositStore = new Map<string, DepositEntry>();

  constructor(
    distributionService: DistributionService | undefined,
    appConfig: FireblocksAppConfig,
    custodyProvider: CustodyProvider,
    finP2PClient: FinP2PClient,
  ) {
    if (!distributionService) {
      throw new Error('Distribution service is required');
    }
    if (!(custodyProvider instanceof FireblocksCustodyProvider)) {
      throw new Error('DirectPaymentsServiceImpl requires a FireblocksCustodyProvider');
    }
    this.distributionService = distributionService;
    this.appConfig = appConfig;
    this.fireblocksProvider = custodyProvider;
    this.finP2PClient = finP2PClient;
  }

  private async createVault(name: string) {
    return this.fireblocksProvider.createDepositVault(name);
  }

  private async getDepositAddress(vaultId: string, contractAddress: string) {
    return this.fireblocksProvider.getDepositAddress(vaultId, contractAddress);
  }

  private startDepositMonitor(vaultId: string, legacyAssetId: string, contractAddress: string, correlationId: string): void {
    this.fireblocksProvider.startDepositMonitor(vaultId, legacyAssetId, async (deposit) => {
      await this.onDepositReceived(vaultId, legacyAssetId, correlationId, contractAddress, deposit);
    });
  }

  private async onDepositReceived(vaultId: string, legacyAssetId: string, correlationId: string, contractAddress: string, deposit: DetectedDeposit): Promise<void> {
    const entry = this.depositStore.get(correlationId);
    if (!entry) {
      throw new Error(`Deposit entry not found for correlationId ${correlationId}`);
    }

    const ossAsset = await this.finP2PClient.getAsset(entry.assetId);
    const omnibusAddress = ossAsset.orgSettlementAccount?.wallet?.address;
    if (!omnibusAddress) {
      throw new Error(`Asset ${entry.assetId} has no orgSettlementAccount wallet address`);
    }
    await this.fireblocksProvider.transferToVaultByAddress(vaultId, omnibusAddress, legacyAssetId, deposit.amount, `deposit instruction: ${correlationId}`);

    // TODO: remove whole number workaround once distribution service supports decimals
    // https://github.com/owneraio/finp2p-nodejs-skeleton-adapter/issues/146
    const wholeAmount = String(Math.floor(Number(deposit.amount)));
    const syncResult = await this.distributionService.syncOmnibus(entry.assetId, entry.assetType);
    console.debug("sync result", syncResult)
    await this.distributionService.distribute(entry.finId, entry.assetId, entry.assetType, wholeAmount);

    await this.finP2PClient.importTransactions([{
      id: deposit.txHash,
      quantity: wholeAmount,
      timestamp: Math.floor(Date.now() / 1000),
      destination: {
        finp2pAccount: {
          account: { finId: entry.finId },
          asset: {
            id: entry.assetId,
            // TODO: use proper CAIP-19 network
            ledgerIdentifier: {
              assetIdentifierType: 'CAIP-19' as const,
              network: 'ethereum',
              tokenId: entry.contractAddress,
              standard: 'ERC20',
            },
          },
        },
      },
      transactionDetails: {
        transactionId: deposit.txHash,
        operationId: correlationId,
      },
      operationType: 'transfer',
    }]);
  }

  async getDepositInstruction(
    idempotencyKey: string,
    owner: Source,
    destination: Destination,
    asset: DepositAsset,
    amount: string | undefined,
    details: any | undefined,
    nonce: string | undefined,
    signature: Signature | undefined,
  ): Promise<DepositOperation> {
    if (asset.assetType === 'custom' || !('assetId' in asset)) {
      throw new Error('Method not implemented.');
    }

    const dbAsset = await getAssetFromDb(asset);

    const correlationId = workflows.generateCid();
    const finId = owner.finId;
    const vaultName = `deposit:${correlationId}:${finId.slice(0, 6)}...${finId.slice(-6)}:${asset.assetId.slice(-6)}`;
    const vault = await this.createVault(vaultName);
    const { walletAddress, legacyAssetId } = await this.getDepositAddress(vault.id, dbAsset.contractAddress);
    await this.fireblocksProvider.fundDepositVault(vault.id);
    this.depositStore.set(correlationId, {
      correlationId, finId,
      assetId: asset.assetId, assetType: asset.assetType,
      walletAddress, vaultId: vault.id,
      contractAddress: dbAsset.contractAddress,
      asset,
    });

    this.startDepositMonitor(vault.id, legacyAssetId, dbAsset.contractAddress, correlationId);

    return successfulDepositOperation({
      account: destination,
      asset,
      description: 'Crypto deposit',
      paymentOptions: [{
        description: 'Crypto transfer',
        currency: asset.assetId,
        methodInstruction: {
          type: 'cryptoTransfer',
          network: 'ethereum',
          contractAddress: dbAsset.contractAddress,
          walletAddress,
        },
      }],
      operationId: correlationId,
      details: undefined,
    });
  }

  async payout(
    idempotencyKey: string,
    source: Source,
    destination: Destination | undefined,
    asset: Asset,
    quantity: string,
    description: string | undefined,
    nonce: string | undefined,
    signature: Signature | undefined,
  ): Promise<ReceiptOperation> {
    throw new Error('Method not implemented.');
  }

}
