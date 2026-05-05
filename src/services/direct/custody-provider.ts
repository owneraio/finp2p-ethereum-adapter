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
  onAssetRegistered?(tokenAddress: string, symbol?: string): Promise<void>;
  /**
   * Ensure `wallet` has at least the configured gas-station threshold available
   * for the next on-chain tx. Pre-funds only when below threshold; the provider
   * is responsible for awaiting the funding tx as needed (e.g. Fireblocks' raw
   * signer returns after broadcast, not mining — needs tx.wait() before the
   * dependent operation can use the new balance, otherwise the next signed tx
   * fails with INSUFFICIENT_FUNDS_FOR_FEE).
   */
  ensureGas?(wallet: CustodyWallet): Promise<void>;
}
