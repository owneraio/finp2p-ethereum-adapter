import { JsonRpcProvider, NonceManager, Provider, Signer, Wallet } from "ethers";
import process from "process";
import { FinP2PContract } from '@owneraio/finp2p-contracts'
import { FinP2PClient } from '@owneraio/finp2p-client'
import { ExecDetailsStore } from './services/finp2p-contract/common'
import { ProofProvider } from '@owneraio/finp2p-nodejs-skeleton-adapter'
import { Logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { InMemoryExecDetailsStore } from './services/finp2p-contract/exec-details-store'
import { FireblocksAppConfig, createFireblocksAppConfig } from './services/direct/fireblocks-config'
import { DfnsAppConfig, createDfnsAppConfig } from './services/direct/dfns-config'
import { BlockdaemonAppConfig, createBlockdaemonAppConfig } from './services/direct/blockdaemon-config'

export type AccountMappingType = 'derivation' | 'database'

const ACCOUNT_MAPPING_TYPES: ReadonlyArray<AccountMappingType> = ['derivation', 'database'];

function resolveAccountMappingType(rawValue: string | undefined): AccountMappingType {
  if (!rawValue) return 'derivation';

  const normalized = rawValue.trim() as AccountMappingType;
  if (ACCOUNT_MAPPING_TYPES.includes(normalized)) return normalized;

  throw new Error(`Invalid ACCOUNT_MAPPING_TYPE: ${rawValue}. Supported values: ${ACCOUNT_MAPPING_TYPES.join(', ')}`);
}

export type AccountModel = 'segregated' | 'omnibus'

const ACCOUNT_MODELS: ReadonlyArray<AccountModel> = ['segregated', 'omnibus'];

function resolveAccountModel(rawValue: string | undefined): AccountModel {
  if (!rawValue) return 'segregated';

  const normalized = rawValue.trim() as AccountModel;
  if (ACCOUNT_MODELS.includes(normalized)) return normalized;

  throw new Error(`Invalid ACCOUNT_MODEL: ${rawValue}. Supported values: ${ACCOUNT_MODELS.join(', ')}`);
}

export type BaseAppConfig = {
  orgId: string
  provider: Provider
  signer: Signer
  finP2PClient: FinP2PClient | undefined
  proofProvider: ProofProvider | undefined
  accountMappingType: AccountMappingType
  accountModel: AccountModel
}

export type FinP2PContractAppConfig = BaseAppConfig & {
  type: 'finp2p-contract'
  finP2PContract: FinP2PContract
  execDetailsStore: ExecDetailsStore | undefined
}

export { FireblocksAppConfig } from './services/direct/fireblocks-config'
export { DfnsAppConfig } from './services/direct/dfns-config'
export { BlockdaemonAppConfig } from './services/direct/blockdaemon-config'

export type AppConfig = FinP2PContractAppConfig | FireblocksAppConfig | DfnsAppConfig | BlockdaemonAppConfig

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

export async function envVarsToAppConfig(logger: Logger): Promise<AppConfig> {
  const configType = (process.env.PROVIDER_TYPE || 'finp2p-contract') as AppConfig['type']
  const accountMappingType = resolveAccountMappingType(process.env.ACCOUNT_MAPPING_TYPE)
  const accountModel = resolveAccountModel(process.env.ACCOUNT_MODEL)

  switch (configType) {
    case 'finp2p-contract': {
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
        type: 'finp2p-contract',
        provider,
        signer,
        finP2PClient,
        proofProvider,
        orgId,
        accountMappingType,
        accountModel,
        finP2PContract,
        execDetailsStore,
      }
    }
    case 'fireblocks': {
      return { ...await createFireblocksAppConfig(), accountMappingType, accountModel }
    }
    case 'dfns': {
      return { ...await createDfnsAppConfig(), accountMappingType, accountModel }
    }
    case 'blockdaemon': {
      return { ...await createBlockdaemonAppConfig(), accountMappingType, accountModel }
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
    console.error(`\nMissing required parameters: ${missingParams.join(", ")}`);
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
