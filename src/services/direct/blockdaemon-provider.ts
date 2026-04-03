import { JsonRpcProvider } from 'ethers';
import { BlockdaemonAppConfig, createIVWallet } from './blockdaemon-config';
import { InstitutionalVaultClient } from './blockdaemon/iv-client';
import { CustodyProvider, CustodyRoleBindings, CustodyWallet, GasStation } from './custody-provider';

export interface BlockdaemonCustodyResult {
  provider: BlockdaemonCustodyProvider;
  roles: CustodyRoleBindings<CustodyWallet>;
}

export class BlockdaemonCustodyProvider implements CustodyProvider {
  readonly rpcProvider;
  readonly gasStation?: GasStation;

  private ivClient: InstitutionalVaultClient;
  private addressToAccountID: Map<string, number>;
  private config: BlockdaemonAppConfig;

  private constructor(
    config: BlockdaemonAppConfig,
    ivClient: InstitutionalVaultClient,
    addressToAccountID: Map<string, number>,
    gasStation?: GasStation,
  ) {
    this.rpcProvider = config.provider;
    this.ivClient = ivClient;
    this.addressToAccountID = addressToAccountID;
    this.config = config;
    this.gasStation = gasStation;
  }

  static async create(config: BlockdaemonAppConfig): Promise<BlockdaemonCustodyResult> {
    const { ivClient, ivNetwork } = config;
    const rpcProvider = config.provider as JsonRpcProvider;

    const createWallet = (accountID: number) =>
      createIVWallet(ivClient, accountID, ivNetwork, rpcProvider);

    const issuerWallet = await createWallet(config.assetIssuerAccountID);
    const escrowWallet = await createWallet(config.assetEscrowAccountID);

    // Cache address → accountID mapping from all IV accounts
    const addressToAccountID = new Map<string, number>();
    const accounts = await ivClient.listAccounts();
    for (const acc of accounts.list) {
      for (const aa of acc.config.assets ?? []) {
        if (aa.asset.config.protocol !== 'ethereum') continue;
        if (aa.asset.config.network !== ivNetwork) continue;
        for (const addr of aa.addresses) {
          if (addr.config.address) {
            addressToAccountID.set(addr.config.address.toLowerCase(), acc.metadata.id);
          }
        }
      }
    }

    let gasStation: GasStation | undefined;
    if (config.gasFunding) {
      const gasWallet = await createWallet(config.gasFunding.accountID);
      gasStation = { wallet: gasWallet, amount: config.gasFunding.amount };
    }

    let omnibusWallet: CustodyWallet | undefined;
    if (config.omnibusAccountID !== undefined) {
      omnibusWallet = await createWallet(config.omnibusAccountID);
    }

    const roles: CustodyRoleBindings<CustodyWallet> = {
      issuer: issuerWallet,
      escrow: escrowWallet,
      ...(omnibusWallet ? { omnibus: omnibusWallet } : {}),
    };

    return {
      provider: new BlockdaemonCustodyProvider(config, ivClient, addressToAccountID, gasStation),
      roles,
    };
  }

  async resolveWallet(address: string): Promise<CustodyWallet | undefined> {
    const accountID = this.addressToAccountID.get(address.toLowerCase());
    if (accountID === undefined) return undefined;

    return createIVWallet(
      this.ivClient, accountID,
      this.config.ivNetwork, this.config.provider as JsonRpcProvider,
    );
  }

  async resolveAddressFromCustodyId(accountID: string): Promise<string> {
    const account = await this.ivClient.getAccount(parseInt(accountID, 10));
    for (const aa of account.config.assets ?? []) {
      if (aa.asset.config.protocol !== 'ethereum') continue;
      if (aa.asset.config.network !== this.config.ivNetwork) continue;
      for (const addr of aa.addresses) {
        if (addr.config.address) return addr.config.address;
      }
    }
    throw new Error(`No Ethereum/${this.config.ivNetwork} address found for IV account ${accountID}`);
  }

  async onAssetRegistered(tokenAddress: string): Promise<void> {
    // Register the ERC-20 token as an asset in IV and add it to the issuer account
    const asset = await this.ivClient.createAsset({
      protocol: 'ethereum',
      network: this.config.ivNetwork,
      contractAddress: tokenAddress,
    });
    await this.ivClient.addAssetToAccount(this.config.assetIssuerAccountID, asset.metadata.id);
  }
}
