import { Provider, Signer } from "ethers";
import { LocalSubmitSigner } from "./local-submit-signer";

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

/**
 * Wraps a CustodyWallet so that signing is done by the custody signer
 * but transactions are submitted via the given local provider.
 */
export function withLocalSubmit(wallet: CustodyWallet, localProvider: Provider): CustodyWallet {
  return {
    provider: localProvider,
    signer: new LocalSubmitSigner(wallet.signer, localProvider),
  };
}
