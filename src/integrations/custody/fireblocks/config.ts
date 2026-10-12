import { ApiBaseUrl, ChainId, FireblocksWeb3Provider } from "@fireblocks/fireblocks-web3-provider";
import { BrowserProvider, JsonRpcProvider, Provider, Signer } from "ethers";
import { BaseAppConfig } from "../../../config";
import { resolveRpcUrl } from "../../../network-rpc";

export type FireblocksAppConfig = BaseAppConfig & {
  type: 'fireblocks'
  apiKey: string
  apiPrivateKey: string
  chainId?: ChainId
  apiBaseUrl?: ApiBaseUrl | string
  omnibusVaultId?: string
  localSubmit?: boolean
  rpcUrl: string
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

  const assetEscrowVaultId = process.env.ASSET_ESCROW_CUSTODY_ACCOUNT_ID || undefined
  const omnibusVaultId = process.env.OMNIBUS_CUSTODY_ACCOUNT_ID || undefined

  const localSubmit = process.env.LOCAL_SUBMIT === 'true';
  const rpcUrl = resolveRpcUrl(chainId);

  let provider: Provider;
  let signer: Signer;

  if (localSubmit) {
    const rpcProvider = new JsonRpcProvider(rpcUrl);
    provider = rpcProvider;
    signer = rpcProvider as any;
  } else {
    const baseVaultId = assetEscrowVaultId ?? omnibusVaultId;
    if (!baseVaultId) {
      throw new Error('At least one of ASSET_ESCROW_CUSTODY_ACCOUNT_ID or OMNIBUS_CUSTODY_ACCOUNT_ID must be set');
    }
    const fb = await createFireblocksEthersProvider({
      apiKey, privateKey: apiPrivateKey, chainId, apiBaseUrl, vaultAccountIds: [baseVaultId]
    });
    provider = fb.provider;
    signer = fb.signer;
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
    omnibusVaultId,
    localSubmit,
    rpcUrl,
  };
}
