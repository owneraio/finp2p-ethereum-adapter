import * as fs from "fs";
import { ApiBaseUrl, ChainId, FireblocksWeb3Provider } from "@fireblocks/fireblocks-web3-provider";
import {
  BrowserProvider,
  JsonRpcProvider,
  NonceManager,
  Provider,
  Signer,
  Wallet
} from "ethers";
import process from "process";
import { privateKeyToFinId } from "../src";
import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";

export type ProviderType = "local" | "fireblocks";


export type ProviderAndSigner = {
  provider: Provider, signer: Signer,
}

export const buildNetworkRpcUrl = (networkHost: string, ethereumRPCAuth: string | undefined): string => {
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

export const createJsonProvider = async (operatorPrivateKey: string, ethereumRPCUrl: string, logger: Logger, userNonceManager: boolean = true): Promise<ProviderAndSigner> => {
  const provider = new JsonRpcProvider(ethereumRPCUrl);
  let signer: Signer;
  if (userNonceManager) {
    signer = new NonceManager(new Wallet(operatorPrivateKey)).connect(provider);
  } else {
    signer = new Wallet(operatorPrivateKey).connect(provider);
  }

  logger.info(`Operator public key: ${privateKeyToFinId(operatorPrivateKey)}`);
  logger.info(`Operator address: ${await signer.getAddress()}`);

  return { provider, signer };
};


export const createFireblocksProvider = async (vaultAccountIds: string[]): Promise<ProviderAndSigner> => {
  const apiKey = process.env.FIREBLOCKS_API_KEY || "";
  if (!apiKey) {
    throw new Error("FIREBLOCKS_API_KEY is not set");
  }

  const privKeyPath = process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH || "";
  if (!privKeyPath) {
    throw new Error("FIREBLOCKS_API_PRIVATE_KEY_PATH is not set");
  }
  const privateKey = fs.readFileSync(privKeyPath, "utf-8");

  const chainId = (process.env.FIREBLOCKS_CHAIN_ID || ChainId.MAINNET) as ChainId;
  const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as ApiBaseUrl;

  const eip1193Provider = new FireblocksWeb3Provider({
    privateKey, apiKey, chainId, apiBaseUrl, vaultAccountIds
  });
  const provider = new BrowserProvider(eip1193Provider);
  const signer = await provider.getSigner();

  return { provider, signer };
};

export const createProviderAndSigner = async (providerType: ProviderType, logger: Logger, useNonceManager: boolean = true): Promise<ProviderAndSigner> => {
  switch (providerType) {
    case "local":
      const networkHost = process.env.NETWORK_HOST;
      if (!networkHost) {
        throw new Error("NETWORK_HOST is not set");
      }
      const ethereumRPCAuth = process.env.NETWORK_AUTH;
      const ethereumRPCUrl = buildNetworkRpcUrl(networkHost, ethereumRPCAuth);

      const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY || "";
      if (!operatorPrivateKey) {
        throw new Error("OPERATOR_PRIVATE_KEY is not set");
      }

      return createJsonProvider(operatorPrivateKey, ethereumRPCUrl, logger, useNonceManager);
    case "fireblocks":
      const vaultAccountIds = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS?.split(",") || [];
      return createFireblocksProvider(vaultAccountIds);
  }
};

