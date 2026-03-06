import { Provider, Signer } from "ethers";
import { AccountMappingService } from "./account-mapping";

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
  readonly accountMapping?: AccountMappingService;

  resolveWallet(account: string): Promise<CustodyWallet | undefined>;
  onAssetRegistered?(tokenAddress: string, symbol?: string): Promise<void>;
}
