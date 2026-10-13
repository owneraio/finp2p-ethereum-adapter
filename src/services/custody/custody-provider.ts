import { Provider, Signer } from "ethers";

export interface CustodyWallet {
  provider: Provider;
  signer: Signer;
}

/** What chain reads can serve: every read (an RPC node), or only chain id, block height and ERC20 balances/decimals (a custodian API). */
export type ChainReadScope = 'full' | 'erc20';

export interface CustodyProvider {
  /** chain reads the custodian decides itself (an RPC when NETWORK_HOST is set, else its own API), for custodians with no RPC transport */
  readonly chainReads?: { provider: Provider; scope: ChainReadScope };
  resolveWallet(account: string): Promise<CustodyWallet | undefined>;
  createWalletForCustodyId?(custodyAccountId: string): Promise<CustodyWallet>;
  resolveAddressFromCustodyId?(custodyAccountId: string): Promise<string>;
  onAssetRegistered?(tokenAddress: string, symbol?: string): Promise<void>;
  createCustodyAccount?(label?: string): Promise<{ custodyAccountId: string; address: string }>;
  archiveCustodyAccount?(custodyAccountId: string): Promise<void>;
}
