import * as fs from "fs";
import { ApiBaseUrl, ChainId, FireblocksWeb3Provider } from "@fireblocks/fireblocks-web3-provider";
import { BrowserProvider, JsonRpcProvider, Provider, Signer } from "ethers";
import { BaseAppConfig } from "../../config";

export type FireblocksAppConfig = BaseAppConfig & {
  type: 'fireblocks'
  apiKey: string
  apiPrivateKey: string
  chainId?: ChainId
  apiBaseUrl?: ApiBaseUrl | string
  assetIssuerVaultId?: string
  assetEscrowVaultId?: string
  omnibusVaultId?: string
  localSubmit?: boolean
  gasFunding?: {
    vaultId: string
    amount: string
  }
}

export const createFireblocksEthersProvider = async (config: {
  apiKey: string;
  privateKey: string;
  chainId: ChainId;
  apiBaseUrl?: ApiBaseUrl | string;
  vaultAccountIds: number | number[] | string | string[];
}): Promise<{ provider: Provider; signer: Signer }> => {
  const eip1193Provider = new FireblocksWeb3Provider({
    privateKey: config.privateKey,
    apiKey: config.apiKey,
    chainId: config.chainId,
    apiBaseUrl: config.apiBaseUrl,
    vaultAccountIds: config.vaultAccountIds,
  });
  const provider = new BrowserProvider(eip1193Provider);
  const signer = await provider.getSigner();
  return { provider, signer };
};

const getNetworkRpcUrl = (): string => {
  let networkHost = process.env.NETWORK_HOST;
  if (!networkHost) {
    throw new Error("NETWORK_HOST is not set");
  }
  const ethereumRPCAuth = process.env.NETWORK_AUTH;
  if (ethereumRPCAuth) {
    if (networkHost.startsWith("https://")) {
      networkHost = "https://" + ethereumRPCAuth + "@" + networkHost.replace("https://", "");
    } else if (networkHost.startsWith("http://")) {
      networkHost = "http://" + ethereumRPCAuth + "@" + networkHost.replace("http://", "");
    } else {
      networkHost = ethereumRPCAuth + "@" + networkHost;
    }
  }
  return networkHost;
};

export async function createFireblocksAppConfig(): Promise<Omit<FireblocksAppConfig, 'accountMappingType' | 'accountModel'>> {
  const orgId = process.env.ORGANIZATION_ID || '';
  const apiKey = process.env.FIREBLOCKS_API_KEY || "";
  if (!apiKey) {
    throw new Error("FIREBLOCKS_API_KEY is not set");
  }

  let apiPrivateKey: string;
  if (process.env.FIREBLOCKS_API_PRIVATE_KEY) {
    apiPrivateKey = process.env.FIREBLOCKS_API_PRIVATE_KEY;
  } else if (process.env.FIREBLOCKS_API_PRIVATE_KEY_BASE64) {
    apiPrivateKey = Buffer.from(process.env.FIREBLOCKS_API_PRIVATE_KEY_BASE64, "base64").toString("utf-8");
  } else {
    throw new Error("FIREBLOCKS_API_PRIVATE_KEY or FIREBLOCKS_API_PRIVATE_KEY_BASE64 must be set");
  }

  const chainId = (process.env.FIREBLOCKS_CHAIN_ID || ChainId.MAINNET) as ChainId;
  const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as ApiBaseUrl;

  const assetIssuerVaultId = process.env.FIREBLOCKS_ASSET_ISSUER_VAULT_ID || undefined
  const assetEscrowVaultId = process.env.FIREBLOCKS_ASSET_ESCROW_VAULT_ID || undefined
  const omnibusVaultId = process.env.FIREBLOCKS_OMNIBUS_VAULT_ID || undefined

  const localSubmit = process.env.LOCAL_SUBMIT === 'true';
  const rpcUrl = getNetworkRpcUrl();
  const rpcProvider = new JsonRpcProvider(rpcUrl);

  let provider: Provider;
  let signer: Signer;

  if (localSubmit) {
    provider = rpcProvider;
    signer = rpcProvider as any;
  } else {
    const baseVaultId = assetIssuerVaultId ?? omnibusVaultId;
    if (!baseVaultId) {
      throw new Error('At least one of FIREBLOCKS_ASSET_ISSUER_VAULT_ID or FIREBLOCKS_OMNIBUS_VAULT_ID must be set');
    }
    const fb = await createFireblocksEthersProvider({
      apiKey, privateKey: apiPrivateKey, chainId, apiBaseUrl, vaultAccountIds: [baseVaultId]
    });
    provider = fb.provider;
    signer = fb.signer;
  }

  let gasFunding: FireblocksAppConfig['gasFunding'] = undefined
  const fundingVaultId = process.env.FIREBLOCKS_GAS_FUNDING_VAULT_ID
  const fundingAssetAmount = process.env.FIREBLOCKS_GAS_FUNDING_AMOUNT
  if (fundingVaultId !== undefined && fundingAssetAmount !== undefined) {
    gasFunding = { vaultId: fundingVaultId, amount: fundingAssetAmount }
  }

  return {
    type: 'fireblocks',
    orgId,
    provider,
    signer,
    finP2PClient: undefined,
    proofProvider: undefined,
    apiKey,
    apiPrivateKey,
    chainId,
    apiBaseUrl,
    assetIssuerVaultId,
    assetEscrowVaultId,
    omnibusVaultId,
    localSubmit,
    gasFunding,
  };
}
