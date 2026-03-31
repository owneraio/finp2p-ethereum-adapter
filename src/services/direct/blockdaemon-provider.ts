import { createBlockdaemonEthersProvider, BlockdaemonAppConfig } from './blockdaemon-config';
import { CustodyProvider, CustodyWallet, GasStation } from './custody-provider';

export class BlockdaemonCustodyProvider implements CustodyProvider {
  readonly issuer: CustodyWallet;
  readonly escrow: CustodyWallet;
  readonly omnibus?: CustodyWallet;
  readonly rpcProvider;
  readonly gasStation?: GasStation;

  private addressToIndex: Map<string, number>;

  private constructor(
    issuer: CustodyWallet,
    escrow: CustodyWallet,
    private readonly config: BlockdaemonAppConfig,
    addressToIndex: Map<string, number>,
    gasStation?: GasStation,
    omnibus?: CustodyWallet,
  ) {
    this.issuer = issuer;
    this.escrow = escrow;
    this.omnibus = omnibus;
    this.rpcProvider = config.provider;
    this.addressToIndex = addressToIndex;
    this.gasStation = gasStation;
  }

  static async create(config: BlockdaemonAppConfig): Promise<BlockdaemonCustodyProvider> {
    const createProvider = (addressIndex: number) => createBlockdaemonEthersProvider({
      rpcUrl: config.rpcUrl,
      masterKeyId: config.masterKeyId,
      addressIndex,
    });

    const issuerWallet = await createProvider(config.assetIssuerAddressIndex);
    const escrowWallet = await createProvider(config.assetEscrowAddressIndex);

    // Cache known address → addressIndex mappings
    const addressToIndex = new Map<string, number>();
    const issuerAddress = await issuerWallet.signer.getAddress();
    addressToIndex.set(issuerAddress.toLowerCase(), config.assetIssuerAddressIndex);
    const escrowAddress = await escrowWallet.signer.getAddress();
    addressToIndex.set(escrowAddress.toLowerCase(), config.assetEscrowAddressIndex);

    let gasStation: GasStation | undefined;
    if (config.gasFunding) {
      const gasWallet = await createProvider(config.gasFunding.addressIndex);
      gasStation = { wallet: gasWallet, amount: config.gasFunding.amount };
      const gasAddress = await gasWallet.signer.getAddress();
      addressToIndex.set(gasAddress.toLowerCase(), config.gasFunding.addressIndex);
    }

    let omnibusWallet: CustodyWallet | undefined;
    if (config.omnibusAddressIndex !== undefined) {
      omnibusWallet = await createProvider(config.omnibusAddressIndex);
      const omnibusAddress = await omnibusWallet.signer.getAddress();
      addressToIndex.set(omnibusAddress.toLowerCase(), config.omnibusAddressIndex);
    }

    return new BlockdaemonCustodyProvider(
      issuerWallet, escrowWallet,
      config, addressToIndex, gasStation, omnibusWallet
    );
  }

  async resolveWallet(address: string): Promise<CustodyWallet | undefined> {
    const addressIndex = this.addressToIndex.get(address.toLowerCase());
    if (addressIndex === undefined) return undefined;

    return createBlockdaemonEthersProvider({
      rpcUrl: this.config.rpcUrl,
      masterKeyId: this.config.masterKeyId,
      addressIndex,
    });
  }

  async resolveAddressFromCustodyId(addressIndex: string): Promise<string> {
    const wallet = await createBlockdaemonEthersProvider({
      rpcUrl: this.config.rpcUrl,
      masterKeyId: this.config.masterKeyId,
      addressIndex: parseInt(addressIndex, 10),
    });
    const address = await wallet.signer.getAddress();

    // Cache the resolved mapping
    this.addressToIndex.set(address.toLowerCase(), parseInt(addressIndex, 10));

    return address;
  }
}
