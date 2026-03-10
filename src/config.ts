import * as fs from "fs";
import { ApiBaseUrl, ChainId, FireblocksWeb3Provider } from "@fireblocks/fireblocks-web3-provider";
import { BrowserProvider, JsonRpcProvider, NonceManager, Provider, Signer, Wallet } from "ethers";
import process from "process";
import { FinP2PContract } from '@owneraio/finp2p-contracts'
import { FinP2PClient } from '@owneraio/finp2p-client'
import { ExecDetailsStore } from './services/finp2p-contract/common'
import { ProofProvider } from '@owneraio/finp2p-nodejs-skeleton-adapter'
import { Logger } from "@owneraio/finp2p-adapter-models";
import { InMemoryExecDetailsStore } from './services/finp2p-contract/exec-details-store'
import { DfnsApiClient } from "@dfns/sdk";
import { AsymmetricKeySigner } from "@dfns/sdk-keysigner";
import { DfnsWallet } from "@dfns/lib-ethersjs6";

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

export type FireblocksAppConfig = BaseAppConfig & {
  type: 'fireblocks'
  apiKey: string
  apiPrivateKey: string
  chainId: ChainId
  apiBaseUrl: ApiBaseUrl | string
  assetIssuerVaultId: string
  assetEscrowVaultId: string
  omnibusVaultId?: string
  gasFunding?: {
    vaultId: string
    amount: string
  }
}

export type DfnsAppConfig = BaseAppConfig & {
  type: 'dfns'
  dfnsBaseUrl: string
  dfnsOrgId: string
  dfnsAuthToken: string
  dfnsCredId: string
  dfnsPrivateKey: string
  rpcUrl: string
  assetIssuerWalletId: string
  assetEscrowWalletId: string
  omnibusWalletId?: string
  gasFunding?: {
    walletId: string
    amount: string
  }
}

export type AppConfig = FinP2PContractAppConfig | FireblocksAppConfig | DfnsAppConfig

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

const createDfnsProvider = async (): Promise<Omit<DfnsAppConfig, 'accountMappingType' | 'accountModel'>> => {
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

  const rpcUrl = getNetworkRpcUrl();
  const provider = new JsonRpcProvider(rpcUrl);

  const issuerWalletId = process.env.DFNS_ASSET_ISSUER_WALLET_ID;
  if (!issuerWalletId) throw new Error('DFNS_ASSET_ISSUER_WALLET_ID is not set');

  const escrowWalletId = process.env.DFNS_ASSET_ESCROW_WALLET_ID;
  if (!escrowWalletId) throw new Error('DFNS_ASSET_ESCROW_WALLET_ID is not set');

  const omnibusWalletId = process.env.DFNS_OMNIBUS_WALLET_ID || undefined;

  // Use issuer wallet as the common signer
  const keySigner = new AsymmetricKeySigner({ credId: dfnsCredId, privateKey: dfnsPrivateKey });
  const dfnsClient = new DfnsApiClient({ baseUrl: dfnsBaseUrl, orgId: dfnsOrgId, authToken: dfnsAuthToken, signer: keySigner });
  const { signer } = await createDfnsEthersProvider({ dfnsClient, walletId: issuerWalletId, rpcUrl });

  let gasFunding: DfnsAppConfig['gasFunding'] = undefined
  const fundingWalletId = process.env.DFNS_GAS_FUNDING_WALLET_ID
  const fundingAmount = process.env.DFNS_GAS_FUNDING_AMOUNT
  if (fundingWalletId !== undefined && fundingAmount !== undefined) {
    gasFunding = { walletId: fundingWalletId, amount: fundingAmount }
  }

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
    assetIssuerWalletId: issuerWalletId,
    assetEscrowWalletId: escrowWalletId,
    omnibusWalletId,
    gasFunding,
  };
};

const createFireblocksProvider = async (): Promise<Omit<FireblocksAppConfig, 'accountMappingType' | 'accountModel'>> => {
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

  const requireVaultIdEnv = (envVar: string): string => {
    const val = process.env[envVar]
    if (val === undefined || val === '') throw new Error(`${envVar} environment variable expected but not set or empty`)
    return val
  }

  const assetIssuerVaultId = requireVaultIdEnv('FIREBLOCKS_ASSET_ISSUER_VAULT_ID')
  const assetEscrowVaultId = requireVaultIdEnv('FIREBLOCKS_ASSET_ESCROW_VAULT_ID')
  const omnibusVaultId = process.env.FIREBLOCKS_OMNIBUS_VAULT_ID || undefined

  // Use issuer vault as the common provider/signer
  const { provider, signer } = await createFireblocksEthersProvider({
    apiKey, privateKey: apiPrivateKey, chainId, apiBaseUrl, vaultAccountIds: [assetIssuerVaultId]
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
    assetIssuerVaultId,
    assetEscrowVaultId,
    omnibusVaultId,
    gasFunding,
  };
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
      return { ...await createFireblocksProvider(), accountMappingType, accountModel }
    }
    case 'dfns': {
      return { ...await createDfnsProvider(), accountMappingType, accountModel }
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
