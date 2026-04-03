import * as fs from "fs";
import { ApiBaseUrl, ChainId } from "@fireblocks/fireblocks-web3-provider";
import { JsonRpcProvider, Provider, Signer } from "ethers";
import { FireblocksSDK } from "fireblocks-sdk";
import { BaseAppConfig } from "../../config";
import { FireblocksCustodySigner } from "./signers/fireblocks-signer";

export type FireblocksAppConfig = BaseAppConfig & {
  type: 'fireblocks'
  apiKey: string
  apiPrivateKey: string
  chainId: ChainId
  apiBaseUrl: ApiBaseUrl | string
  fireblocksAssetId: string
  assetIssuerVaultId: string
  assetEscrowVaultId: string
  omnibusVaultId?: string
  gasFunding?: {
    vaultId: string
    amount: string
  }
}

/**
 * Resolve the deposit address for a Fireblocks vault account.
 */
async function resolveVaultAddress(fireblocksSdk: FireblocksSDK, vaultAccountId: string, assetId: string): Promise<string> {
  const addresses = await fireblocksSdk.getDepositAddresses(vaultAccountId, assetId);
  if (addresses.length === 0) {
    throw new Error(`No deposit address found for Fireblocks vault ${vaultAccountId} asset ${assetId}`);
  }
  return addresses[0].address;
}

export const createFireblocksCustodyWallet = async (config: {
  fireblocksSdk: FireblocksSDK;
  vaultAccountId: string;
  fireblocksAssetId: string;
  rpcProvider: JsonRpcProvider;
}): Promise<{ provider: Provider; signer: Signer }> => {
  const address = await resolveVaultAddress(config.fireblocksSdk, config.vaultAccountId, config.fireblocksAssetId);
  const signer = new FireblocksCustodySigner(
    address, config.fireblocksSdk, config.vaultAccountId, config.rpcProvider, config.fireblocksAssetId,
  );
  return { provider: config.rpcProvider, signer };
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
  const fireblocksAssetId = process.env.FIREBLOCKS_ASSET_ID || 'ETH_TEST5';

  const requireVaultIdEnv = (envVar: string): string => {
    const val = process.env[envVar]
    if (val === undefined || val === '') throw new Error(`${envVar} environment variable expected but not set or empty`)
    return val
  }

  const assetIssuerVaultId = requireVaultIdEnv('FIREBLOCKS_ASSET_ISSUER_VAULT_ID')
  const assetEscrowVaultId = requireVaultIdEnv('FIREBLOCKS_ASSET_ESCROW_VAULT_ID')
  const omnibusVaultId = process.env.FIREBLOCKS_OMNIBUS_VAULT_ID || undefined

  const rpcUrl = getNetworkRpcUrl();
  const rpcProvider = new JsonRpcProvider(rpcUrl);
  const fireblocksSdk = new FireblocksSDK(apiPrivateKey, apiKey, apiBaseUrl as string);

  const { provider, signer } = await createFireblocksCustodyWallet({
    fireblocksSdk, vaultAccountId: assetIssuerVaultId, fireblocksAssetId, rpcProvider,
  });

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
    fireblocksAssetId,
    assetIssuerVaultId,
    assetEscrowVaultId,
    omnibusVaultId,
    gasFunding,
  };
}
