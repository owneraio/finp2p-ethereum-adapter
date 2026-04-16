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
  readonly omnibus?: CustodyWallet;
  readonly rpcProvider: Provider;
  readonly gasStation?: GasStation;

  resolveWallet(account: string): Promise<CustodyWallet | undefined>;
  /** Create a wallet directly from custody account ID (vault ID / wallet ID). No reverse scan needed. */
  createWalletForCustodyId?(custodyAccountId: string): Promise<CustodyWallet>;
  resolveAddressFromCustodyId?(custodyAccountId: string): Promise<string>;
  /** Fund gas for a wallet before an on-chain tx. Vendor-specific (e.g. Fireblocks polls tx status). */
  fundGasIfNeeded?(wallet: CustodyWallet): Promise<void>;
  onAssetRegistered?(tokenAddress: string, symbol?: string): Promise<void>;
}
