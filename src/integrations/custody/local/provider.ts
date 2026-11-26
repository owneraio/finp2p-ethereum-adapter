import { Wallet, getAddress } from "ethers";
import { CustodyProvider, CustodyWallet } from "../../../services/custody";
import { getNetworkRpcUrl } from "../../../network-host";
import { pooledProvider, pooledSigner } from "../../signer-pool";
import { LocalCustodyConfig } from "./config";

/**
 * Dev-only custody: the adapter signs with keys from its own environment.
 * The custody account id is the wallet address. It cannot create accounts, so
 * deposits that need a fresh custody address are refused.
 */
export class LocalCustodyProvider implements CustodyProvider {

  private readonly keysByAddress = new Map<string, string>();

  constructor(config: LocalCustodyConfig, private readonly rpcUrl: string = getNetworkRpcUrl()) {
    for (const key of config.privateKeys) {
      this.keysByAddress.set(new Wallet(key).address.toLowerCase(), key);
    }
  }

  private walletOf(address: string): CustodyWallet | undefined {
    const key = this.keysByAddress.get(address.toLowerCase());
    return key === undefined ? undefined : { provider: pooledProvider(this.rpcUrl), signer: pooledSigner(this.rpcUrl, key) };
  }

  async resolveWallet(account: string): Promise<CustodyWallet | undefined> {
    return this.walletOf(account);
  }

  async createWalletForCustodyId(custodyAccountId: string): Promise<CustodyWallet> {
    const wallet = this.walletOf(custodyAccountId);
    if (!wallet) throw new Error(`unknown local custody account ${custodyAccountId}`);
    return wallet;
  }

  async resolveAddressFromCustodyId(custodyAccountId: string): Promise<string> {
    if (!this.keysByAddress.has(custodyAccountId.toLowerCase())) {
      throw new Error(`unknown local custody account ${custodyAccountId}`);
    }
    return getAddress(custodyAccountId.toLowerCase());
  }
}
