import { Provider, Signer } from "ethers";

export interface CustodyWallet {
  provider: Provider;
  signer: Signer;
}

export interface CustodyProvider {
  /** RPC endpoint chain reads go through: NETWORK_HOST, or a public endpoint of the custodian's chain */
  readonly rpcUrl?: string;
  resolveWallet(account: string): Promise<CustodyWallet | undefined>;
  createWalletForCustodyId?(custodyAccountId: string): Promise<CustodyWallet>;
  resolveAddressFromCustodyId?(custodyAccountId: string): Promise<string>;
  onAssetRegistered?(tokenAddress: string, symbol?: string): Promise<void>;
  createCustodyAccount?(label?: string): Promise<{ custodyAccountId: string; address: string }>;
  archiveCustodyAccount?(custodyAccountId: string): Promise<void>;
}
