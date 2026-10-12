import { Provider, Signer } from "ethers";

export interface CustodyWallet {
  provider: Provider;
  signer: Signer;
}

export interface CustodyProvider {
  /** chain reads served by the custodian itself (no RPC node); when present, NETWORK_HOST is not used */
  readonly readProvider?: Provider;
  resolveWallet(account: string): Promise<CustodyWallet | undefined>;
  createWalletForCustodyId?(custodyAccountId: string): Promise<CustodyWallet>;
  resolveAddressFromCustodyId?(custodyAccountId: string): Promise<string>;
  onAssetRegistered?(tokenAddress: string, symbol?: string): Promise<void>;
  createCustodyAccount?(label?: string): Promise<{ custodyAccountId: string; address: string }>;
  archiveCustodyAccount?(custodyAccountId: string): Promise<void>;
}
