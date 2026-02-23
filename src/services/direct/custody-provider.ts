import { Provider, Signer } from "ethers";

export interface CustodyWallet {
  provider: Provider;
  signer: Signer;
}

export interface GasStation {
  wallet: CustodyWallet;
  amount: string;
}

export interface CustodyProvider {
  readonly issuer: CustodyWallet;
  readonly escrow: CustodyWallet;
  readonly healthCheckProvider: Provider;
  readonly gasStation?: GasStation;

  resolveWalletForAddress(address: string): Promise<CustodyWallet | undefined>;
  onAssetRegistered?(tokenAddress: string, symbol?: string): Promise<void>;
}
