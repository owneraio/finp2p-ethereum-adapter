import * as fs from "fs";
import { ApiBaseUrl, ChainId, FireblocksWeb3Provider } from "@fireblocks/fireblocks-web3-provider";
import { BrowserProvider, JsonRpcProvider, NonceManager, Provider, Signer, Wallet, JsonRpcSigner } from "ethers";
import process from "process";
import { FinP2PContract } from '@owneraio/finp2p-contracts'
import { FinP2PClient } from '@owneraio/finp2p-client'
import { ExecDetailsStore } from './services/common'
import { ProofProvider } from '@owneraio/finp2p-nodejs-skeleton-adapter'
import { Logger } from "@owneraio/finp2p-adapter-models";
import { InMemoryExecDetailsStore } from './services/exec-details-store'
import { FireblocksSDK } from "fireblocks-sdk";
import { createVaultManagementFunctions } from './vaults'

export type LocalAppConfig = {
  type: 'local'
  orgId: string
  provider: Provider
  signer: Signer
  finP2PContract: FinP2PContract
  finP2PClient: FinP2PClient | undefined
  execDetailsStore: ExecDetailsStore | undefined
  proofProvider: ProofProvider
}

export type FireblocksAppConfig = {
  type: 'fireblocks'
  provider: BrowserProvider
  signer: JsonRpcSigner
  fireblocksSdk: FireblocksSDK
}

export type AppConfig = LocalAppConfig | FireblocksAppConfig

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

export const createJsonProvider = (
  operatorPrivateKey: string, ethereumRPCUrl: string, useNonceManager: boolean = true
): { provider: Provider, signer: Signer } => {
  const provider = new JsonRpcProvider(ethereumRPCUrl);
  let signer: Signer;
  if (useNonceManager) {
    signer = new NonceManager(new Wallet(operatorPrivateKey)).connect(provider);
  } else {
    signer = new Wallet(operatorPrivateKey).connect(provider);
  }

  return { provider, signer };
};

const createFireblocksProvider =  async (vaultAccountIds: string[]): Promise<{
  provider: BrowserProvider,
  signer: JsonRpcSigner,
  fireblocksSdk: FireblocksSDK,
  createProviderForExternalAddress: (address: string) => Promise<FireblocksWeb3Provider | undefined>
}> => {
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
  const fireblocksSdk = new FireblocksSDK(privateKey, apiKey, (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production))

  const vaultManagement = createVaultManagementFunctions(fireblocksSdk)

  return {
    provider,
    signer,
    fireblocksSdk,
    createProviderForExternalAddress: async (address: string) => {
      const vaultId = await vaultManagement.getVaultIdForAddress(address)
      if (vaultId === undefined) return undefined

      return new FireblocksWeb3Provider({
        privateKey, apiKey, chainId, apiBaseUrl, vaultAccountIds: [vaultId]
      })
    }
  };
};

export async function envVarsToAppConfig(logger: Logger): Promise<AppConfig> {
  const configType = (process.env.PROVIDER_TYPE || 'local') as AppConfig['type']

  switch (configType) {
    case 'local': {
      const finP2PContractAddress = process.env.FINP2P_CONTRACT_ADDRESS || process.env.TOKEN_ADDRESS; // TOKEN_ADDRESS for backward compatibility
      if (!finP2PContractAddress) {
        throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
      }

      const orgId = process.env.ORGANIZATION_ID;
      if (!orgId) {
        throw new Error("ORGANIZATION_ID is not set");
      }

      const finP2PUrl = process.env.FINP2P_ADDRESS;
      if (!finP2PUrl) {
        throw new Error("FINP2P_ADDRESS is not set");
      }

      const ossUrl = process.env.OSS_URL;
      if (!ossUrl) {
        throw new Error("OSS_URL is not set");
      }

      const useNonceManager = (process.env.USE_NONCE_MANAGER ?? "yes" ) === "yes";
      const ethereumRPCUrl = getNetworkRpcUrl();
      const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
      if (!operatorPrivateKey) {
        throw new Error("OPERATOR_PRIVATE_KEY is not set");
      }

      const { provider, signer } = createJsonProvider(operatorPrivateKey, ethereumRPCUrl, useNonceManager)

      const finP2PContract = new FinP2PContract(
        provider,
        signer,
        finP2PContractAddress,
        logger
      );
      const finP2PClient = new FinP2PClient(finP2PUrl, ossUrl);
      const execDetailsStore = new InMemoryExecDetailsStore();
      const proofProvider = new ProofProvider(orgId, finP2PClient, operatorPrivateKey)

      const contractVersion = await finP2PContract.getVersion();
      logger.info(`FinP2P contract version: ${contractVersion}`);
      const { name, version, chainId, verifyingContract } =
        await finP2PContract.eip712Domain();
      logger.info(
        `EIP712 domain: name=${name} version=${version} chainId=${chainId} verifyingContract=${verifyingContract}`
      );

      return {
        type: 'local',
        orgId,
        execDetailsStore,
        finP2PClient,
        finP2PContract,
        proofProvider,
        provider,
        signer
      }
    }
    case 'fireblocks': {
      const envVaultAccountIdsStr = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS;
      const vaultAccountIds = envVaultAccountIdsStr ? envVaultAccountIdsStr.split(",").map(id => id.trim()) : [];
      if (vaultAccountIds.length === 0) {
        throw new Error("FIREBLOCKS_VAULT_ACCOUNT_IDS is not set or empty");
      }

      const { provider, signer, fireblocksSdk } = await createFireblocksProvider(vaultAccountIds)
      return {
        type: 'fireblocks',
        provider,
        signer,
        fireblocksSdk
      }
    }
  }
}

export interface ParamDefinition {
  name: string;
  envVar: string;
  required?: boolean;
  description?: string;
  defaultValue?: string;
  type?: "string" | "number" | "boolean";
}

export interface ParsedConfig {
  [key: string]: string | undefined;
}

function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

function toKebabCase(str: string): string {
  return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}


function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const key = toCamelCase(arg.slice(2));
      const value = args[i + 1];

      if (value && !value.startsWith("--")) {
        parsed[key] = value;
        i++;
      } else {
        parsed[key] = "true";
      }
    }
  }

  return parsed;
}

function printUsage(scriptName: string, params: ParamDefinition[], missingParams?: string[]): void {
  console.error(`\nUsage: node ${scriptName} [options]\n`);
  console.error("Options:");

  params.forEach(param => {
    const flag = `--${toKebabCase(param.name)}`;
    const required = param.required ? " (required)" : "";
    const defaultVal = param.defaultValue ? ` [default: ${param.defaultValue}]` : "";
    const description = param.description || "";

    console.error(`  ${flag.padEnd(25)} ${description}${required}${defaultVal}`);
    console.error(`  ${" ".padEnd(25)} Env: ${param.envVar}`);
  });

  if (missingParams && missingParams.length > 0) {
    console.error(`\n❌ Missing required parameters: ${missingParams.join(", ")}`);
  }

  console.error("\nExamples:");
  console.error(`  node ${scriptName} ${params.map(p => `--${toKebabCase(p.name)} <value>`).join(" ")}`);
  console.error(`  ${params.map(p => `${p.envVar}=<value>`).join(" ")} node ${scriptName}`);
  console.error("");
}

export function parseConfig(params: ParamDefinition[]): ParsedConfig {
  const args = parseArgs(process.argv.slice(2));
  const config: ParsedConfig = {};
  const missingParams: string[] = [];

  params.forEach(param => {
    // Priority: CLI args > env vars > default value
    const cliValue = args[param.name];
    const envValue = process.env[param.envVar];
    const value = cliValue || envValue || param.defaultValue;

    if (param.required && value === undefined) {
      missingParams.push(param.name);
    }

    config[param.name] = value;
  });

  if (missingParams.length > 0) {
    const scriptName = process.argv[1].split("/").pop() || "script.js";
    printUsage(scriptName, params, missingParams);
    process.exit(1);
  }

  return config;
}

