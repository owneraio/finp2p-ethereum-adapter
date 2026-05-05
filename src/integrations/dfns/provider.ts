import { DfnsApiClient } from '@dfns/sdk';
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner';
import { DfnsWallet } from '@dfns/lib-ethersjs6';
import { JsonRpcProvider, parseEther } from 'ethers';
import { DfnsAppConfig } from './config';
import { CustodyProvider, CustodyWallet, GasStation, GAS_FUNDING_TIMEOUT_MS, GAS_FUNDING_POLL_INTERVAL_MS } from '../../services/direct';

export class DfnsCustodyProvider implements CustodyProvider {
  readonly issuer: CustodyWallet;
  readonly escrow: CustodyWallet;
  readonly omnibus?: CustodyWallet;
  readonly rpcProvider;
  readonly gasStation?: GasStation;

  private dfnsClient: DfnsApiClient;
  private addressToWalletId: Map<string, string>;

  private constructor(
    issuer: CustodyWallet,
    escrow: CustodyWallet,
    private readonly config: DfnsAppConfig,
    dfnsClient: DfnsApiClient,
    addressToWalletId: Map<string, string>,
    gasStation?: GasStation,
    omnibus?: CustodyWallet,
  ) {
    this.issuer = issuer;
    this.escrow = escrow;
    this.omnibus = omnibus;
    this.rpcProvider = config.provider;
    this.dfnsClient = dfnsClient;
    this.addressToWalletId = addressToWalletId;
    this.gasStation = gasStation;
  }

  private static createDfnsClient(config: DfnsAppConfig): DfnsApiClient {
    const keySigner = new AsymmetricKeySigner({ credId: config.dfnsCredId, privateKey: config.dfnsPrivateKey });
    return new DfnsApiClient({ baseUrl: config.dfnsBaseUrl, orgId: config.dfnsOrgId, authToken: config.dfnsAuthToken, signer: keySigner });
  }

  private static async createWalletProvider(dfnsClient: DfnsApiClient, walletId: string, rpcUrl: string): Promise<CustodyWallet> {
    const provider = new JsonRpcProvider(rpcUrl);
    const dfnsWallet = await DfnsWallet.init({ walletId, dfnsClient });
    const signer = dfnsWallet.connect(provider);
    return { provider, signer };
  }

  static async create(config: DfnsAppConfig): Promise<DfnsCustodyProvider> {
    const dfnsClient = DfnsCustodyProvider.createDfnsClient(config);

    const issuerWallet = await DfnsCustodyProvider.createWalletProvider(dfnsClient, config.assetIssuerWalletId, config.rpcUrl);
    const escrowWallet = await DfnsCustodyProvider.createWalletProvider(dfnsClient, config.assetEscrowWalletId, config.rpcUrl);

    // Cache address → walletId mapping
    const addressToWalletId = new Map<string, string>();
    const { items } = await dfnsClient.wallets.listWallets({});
    for (const w of items) {
      if (w.address) {
        addressToWalletId.set(w.address.toLowerCase(), w.id);
      }
    }

    let gasStation: GasStation | undefined;
    if (config.gasFunding) {
      const gasWallet = await DfnsCustodyProvider.createWalletProvider(dfnsClient, config.gasFunding.walletId, config.rpcUrl);
      gasStation = { wallet: gasWallet, amount: config.gasFunding.amount };
    }

    let omnibusWallet: CustodyWallet | undefined;
    if (config.omnibusWalletId) {
      omnibusWallet = await DfnsCustodyProvider.createWalletProvider(dfnsClient, config.omnibusWalletId, config.rpcUrl);
    }

    return new DfnsCustodyProvider(issuerWallet, escrowWallet, config, dfnsClient, addressToWalletId, gasStation, omnibusWallet);
  }

  async createWalletForCustodyId(walletId: string): Promise<CustodyWallet> {
    return DfnsCustodyProvider.createWalletProvider(this.dfnsClient, walletId, this.config.rpcUrl);
  }

  async resolveWallet(address: string): Promise<CustodyWallet | undefined> {
    const walletId = this.addressToWalletId.get(address.toLowerCase());
    if (walletId === undefined) return undefined;
    return DfnsCustodyProvider.createWalletProvider(this.dfnsClient, walletId, this.config.rpcUrl);
  }

  async resolveAddressFromCustodyId(walletId: string): Promise<string> {
    const wallet = await this.dfnsClient.wallets.getWallet({ walletId });
    if (!wallet.address) {
      throw new Error(`No address found for DFNS wallet ${walletId}`);
    }
    return wallet.address;
  }

  /**
   * Pre-fund only when below threshold; block until the target's on-chain
   * balance actually reflects the funding before returning. DFNS resolves
   * sendTransaction once the broadcast is queued, not when mined; polling
   * the target balance is the strongest signal that the funding is usable
   * by the next op.
   */
  async ensureGas(walletAddress: string): Promise<void> {
    if (!this.gasStation) return;
    const threshold = parseEther(this.gasStation.amount);
    let balance = await this.rpcProvider.getBalance(walletAddress);
    if (balance >= threshold) return;

    await this.gasStation.wallet.signer.sendTransaction({
      to: walletAddress,
      value: threshold,
    });

    const deadline = Date.now() + GAS_FUNDING_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, GAS_FUNDING_POLL_INTERVAL_MS));
      balance = await this.rpcProvider.getBalance(walletAddress);
      if (balance >= threshold) return;
    }
    throw new Error(`Gas top-up to ${walletAddress} did not reflect on-chain after ${GAS_FUNDING_TIMEOUT_MS}ms (last balance: ${balance})`);
  }
}
