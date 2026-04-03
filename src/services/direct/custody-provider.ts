import { Provider, Signer } from "ethers";

export interface CustodyWallet {
  provider: Provider;
  signer: Signer;
}

export interface GasStation {
  wallet: CustodyWallet;
  amount: string;
}

export interface CustodyRoleBindings<TWallet> {
  readonly issuer: TWallet;
  readonly escrow: TWallet;
  readonly omnibus?: TWallet;
}

export interface CustodyProvider {
  readonly rpcProvider: Provider;
  readonly gasStation?: GasStation;

  resolveWallet(account: string): Promise<CustodyWallet | undefined>;
  resolveAddressFromCustodyId?(custodyAccountId: string): Promise<string>;
  onAssetRegistered?(tokenAddress: string, symbol?: string): Promise<void>;
}
