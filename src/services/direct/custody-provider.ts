import { Provider, Signer } from "ethers";

export interface CustodyWallet {
  provider: Provider;
  signer: Signer;
}

export interface GasStation {
  wallet: CustodyWallet;
  amount: string;
}

/** How long ensureGas waits for the target wallet's balance to reflect the funding tx. */
export const GAS_FUNDING_TIMEOUT_MS = 60_000;
/** Poll interval for target balance during ensureGas. */
export const GAS_FUNDING_POLL_INTERVAL_MS = 1_000;

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
   * Ensure `walletAddress` has at least the configured gas-station threshold
   * available for the next on-chain tx. Pre-funds only when below threshold;
   * the provider is responsible for waiting until the new balance is reflected
   * on-chain before returning, so the dependent op doesn't fail with
   * INSUFFICIENT_FUNDS_FOR_FEE.
   */
  ensureGas?(walletAddress: string): Promise<void>;
}
