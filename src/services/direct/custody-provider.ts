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
   * Provision a brand-new custody account (vault / wallet) and return its identifier
   * and EVM deposit address. Used by deposit methods that allocate a single-use address
   * per deposit (see ota-deposit). The returned `custodyAccountId` is a valid input to
   * `createWalletForCustodyId` for later signing — callers compose the two when they
   * need the signer (e.g. at sweep time).
   *
   * Implementations should ensure the new account is EVM-enabled (deposit address
   * generated for the chain in use). The optional `label` is for operator visibility
   * in the custody dashboard (not load-bearing).
   */
  createCustodyAccount?(label?: string): Promise<{ custodyAccountId: string; address: string }>;
  /**
   * Mark a previously-created custody account as no-longer-in-use. Best-effort cleanup
   * after a single-use OTA-deposit account has been swept. Neither Fireblocks nor DFNS
   * support hard-delete of vault accounts/wallets — the underlying call is `hideVaultAccount`
   * (Fireblocks) or `tagWallet` (DFNS). Any leftover dust (e.g. unused gas) remains in
   * custody but invisible to operators.
   */
  archiveCustodyAccount?(custodyAccountId: string): Promise<void>;
}
