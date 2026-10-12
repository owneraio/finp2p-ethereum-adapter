import * as fs from "fs";
import { DfnsApiClient } from "@dfns/sdk";
import { AsymmetricKeySigner } from "@dfns/sdk-keysigner";
import { DfnsWallet } from "@dfns/lib-ethersjs6";
import { JsonRpcProvider, Provider, Signer } from "ethers";
import { BaseAppConfig } from "../../../config";
import { configuredRpcUrl, resolveRpcUrl } from "../../../network-rpc";

export type DfnsAppConfig = BaseAppConfig & {
  type: 'dfns'
  dfnsBaseUrl: string
  dfnsOrgId: string
  dfnsAuthToken: string
  dfnsCredId: string
  dfnsPrivateKey: string
  rpcUrl: string
  omnibusWalletId?: string
}

export const createDfnsEthersProvider = async (config: {
  dfnsClient: DfnsApiClient;
  walletId: string;
  rpcUrl: string;
}): Promise<{ provider: Provider; signer: Signer }> => {
  const provider = new JsonRpcProvider(config.rpcUrl);
  const dfnsWallet = await DfnsWallet.init({
    walletId: config.walletId,
    dfnsClient: config.dfnsClient,
  });
  const signer = dfnsWallet.connect(provider);
  return { provider, signer };
};

const EVM_CHAIN_IDS: Record<string, number> = {
  Ethereum: 1,
  EthereumSepolia: 11155111,
  EthereumHolesky: 17000,
  EthereumHoodi: 560048,
  Hedera: 295,
  HederaTestnet: 296,
  Base: 8453,
  BaseSepolia: 84532,
  Polygon: 137,
  PolygonAmoy: 80002,
  ArbitrumOne: 42161,
  ArbitrumSepolia: 421614,
  Optimism: 10,
  OptimismSepolia: 11155420,
  Bsc: 56,
  BscTestnet: 97,
  AvalancheC: 43114,
  AvalancheCFuji: 43113,
};

/** NETWORK_HOST, or a public RPC of the chain DFNS_NETWORK (or else the base wallet) is on. */
async function dfnsRpcUrl(dfnsClient: DfnsApiClient, baseWalletId: string): Promise<string> {
  const configured = configuredRpcUrl();
  if (configured) return configured;
  const network = process.env.DFNS_NETWORK || (await dfnsClient.wallets.getWallet({ walletId: baseWalletId })).network;
  const chainId = EVM_CHAIN_IDS[network];
  if (chainId === undefined) throw new Error(`DFNS network '${network}' is not a known EVM network; set NETWORK_HOST`);
  return resolveRpcUrl(chainId);
}

export async function createDfnsAppConfig(): Promise<Omit<DfnsAppConfig, 'accountMappingType' | 'accountModel'>> {
  const orgId = process.env.ORGANIZATION_ID || '';
  const dfnsBaseUrl = process.env.DFNS_BASE_URL || 'https://api.dfns.io';
  const dfnsOrgId = process.env.DFNS_ORG_ID;
  if (!dfnsOrgId) throw new Error('DFNS_ORG_ID is not set');

  const dfnsAuthToken = process.env.DFNS_AUTH_TOKEN;
  if (!dfnsAuthToken) throw new Error('DFNS_AUTH_TOKEN is not set');

  const dfnsCredId = process.env.DFNS_CRED_ID;
  if (!dfnsCredId) throw new Error('DFNS_CRED_ID is not set');

  const privateKeyPath = process.env.DFNS_PRIVATE_KEY_PATH;
  const privateKeyEnv = process.env.DFNS_PRIVATE_KEY;
  const dfnsPrivateKey = privateKeyPath
    ? fs.readFileSync(privateKeyPath, 'utf-8')
    : privateKeyEnv;
  if (!dfnsPrivateKey) throw new Error('DFNS_PRIVATE_KEY or DFNS_PRIVATE_KEY_PATH is not set');

  const escrowWalletId = process.env.ASSET_ESCROW_CUSTODY_ACCOUNT_ID || undefined;
  const omnibusWalletId = process.env.OMNIBUS_CUSTODY_ACCOUNT_ID || undefined;
  const baseWalletId = escrowWalletId ?? omnibusWalletId;
  if (!baseWalletId) throw new Error('At least one of ASSET_ESCROW_CUSTODY_ACCOUNT_ID or OMNIBUS_CUSTODY_ACCOUNT_ID must be set');

  const keySigner = new AsymmetricKeySigner({ credId: dfnsCredId, privateKey: dfnsPrivateKey });
  const dfnsClient = new DfnsApiClient({ baseUrl: dfnsBaseUrl, orgId: dfnsOrgId, authToken: dfnsAuthToken, signer: keySigner });
  const rpcUrl = await dfnsRpcUrl(dfnsClient, baseWalletId);
  const provider = new JsonRpcProvider(rpcUrl);
  const { signer } = await createDfnsEthersProvider({ dfnsClient, walletId: baseWalletId, rpcUrl });

  return {
    type: 'dfns',
    orgId,
    provider,
    signer,
    finP2PClient: undefined,
    proofProvider: undefined,
    dfnsBaseUrl,
    dfnsOrgId,
    dfnsAuthToken,
    dfnsCredId,
    dfnsPrivateKey,
    rpcUrl,
    omnibusWalletId,
  };
}
