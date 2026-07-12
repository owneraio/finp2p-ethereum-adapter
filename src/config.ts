import { Interface, JsonRpcProvider, NonceManager, Provider, Signer, Wallet, ZeroAddress, keccak256, toUtf8Bytes } from "ethers";
import process from "process";
import { FinP2PContract, FinP2POrchestratorContract } from '@owneraio/finp2p-contracts'
import { FinP2PClient } from '@owneraio/finp2p-client'
import { ExecDetailsStore } from './services/finp2p-contract/common'
import { ProofProvider } from '@owneraio/finp2p-nodejs-skeleton-adapter'
import { Logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { InMemoryExecDetailsStore } from './services/finp2p-contract/exec-details-store'
import { FireblocksAppConfig, createFireblocksAppConfig } from './integrations/fireblocks/config'
import { DfnsAppConfig, createDfnsAppConfig } from './integrations/dfns/config'

export const DEFAULT_ASSET_STANDARD_ERC20 = keccak256(toUtf8Bytes("ERC20"));

export type AccountMappingType = 'database'

function resolveAccountMappingType(rawValue: string | undefined): AccountMappingType {
  if (rawValue && rawValue.trim() !== 'database') {
    throw new Error(`Invalid ACCOUNT_MAPPING_TYPE: ${rawValue}. Only 'database' is supported.`);
  }
  return 'database';
}

export type AccountModel = 'segregated' | 'omnibus'

const ACCOUNT_MODELS: ReadonlyArray<AccountModel> = ['segregated', 'omnibus'];

function resolveAccountModel(rawValue: string | undefined): AccountModel {
  if (!rawValue) return 'segregated';

  const normalized = rawValue.trim() as AccountModel;
  if (ACCOUNT_MODELS.includes(normalized)) return normalized;

  throw new Error(`Invalid ACCOUNT_MODEL: ${rawValue}. Supported values: ${ACCOUNT_MODELS.join(', ')}`);
}

export type EscrowProviderType = 'wallet' | 'contract'

const ESCROW_PROVIDERS: ReadonlyArray<EscrowProviderType> = ['wallet', 'contract'];

function resolveEscrowProvider(rawValue: string | undefined): EscrowProviderType {
  if (!rawValue) return 'wallet';
  const normalized = rawValue.trim() as EscrowProviderType;
  if (ESCROW_PROVIDERS.includes(normalized)) return normalized;
  throw new Error(`Invalid ESCROW_PROVIDER: ${rawValue}. Supported values: ${ESCROW_PROVIDERS.join(', ')}`);
}

export type BaseAppConfig = {
  orgId: string
  provider: Provider
  signer: Signer
  finP2PClient: FinP2PClient | undefined
  proofProvider: ProofProvider | undefined
  accountMappingType: AccountMappingType
  accountModel: AccountModel
  // direct mode: 'contract' routes holds through the standalone FinP2PEscrow
  // contract at escrowContractAddress instead of the custody escrow wallet
  escrowProvider?: EscrowProviderType
  escrowContractAddress?: string
}

export type FinP2PContractAppConfig = BaseAppConfig & {
  type: 'finp2p-contract'
  finP2PContract: FinP2PContract
  execDetailsStore: ExecDetailsStore | undefined
  defaultAssetStandard?: string
  // v2 (plan-based) operator; set when FINP2P_CONTRACT_VERSION=2
  orchestrator?: FinP2POrchestratorContract
}

export { FireblocksAppConfig } from './integrations/fireblocks/config'
export { DfnsAppConfig } from './integrations/dfns/config'

/**
 * Generic config for custody providers activated via the registry.
 * The provider factory is responsible for reading its own env vars.
 * The type excludes known built-in types to allow TypeScript narrowing.
 */
export type CustodyAppConfig = BaseAppConfig & {
  type: string
}

export type AppConfig = FinP2PContractAppConfig | FireblocksAppConfig | DfnsAppConfig | CustodyAppConfig

export const getNetworkRpcUrl = (): string => {
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
  const escrowProvider = resolveEscrowProvider(process.env.ESCROW_PROVIDER)
  const escrowContractAddress = process.env.ESCROW_CONTRACT_ADDRESS
  if (escrowProvider === 'contract' && !escrowContractAddress) {
    throw new Error("ESCROW_CONTRACT_ADDRESS is not set (required when ESCROW_PROVIDER=contract)");
  }

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

      // Per-attempt confirmation timeout for safeExecuteTransaction's
      // response.wait(); defaults to 10 min in finp2p-contracts. Operator can
      // raise/lower for slower / faster networks.
      const txConfirmationTimeoutMsRaw = process.env.TX_CONFIRMATION_TIMEOUT_MS;
      const txConfirmationTimeoutMs = txConfirmationTimeoutMsRaw ? Number(txConfirmationTimeoutMsRaw) : undefined;
      if (txConfirmationTimeoutMsRaw && Number.isNaN(txConfirmationTimeoutMs!)) {
        throw new Error(`Invalid TX_CONFIRMATION_TIMEOUT_MS: ${txConfirmationTimeoutMsRaw}`);
      }

      // EIP-1559 gas tier — slow|normal|fast — scales the node's feeData
      // priority/max fees per tx to position in the validator's priority queue.
      // Defaults to `normal` in finp2p-contracts (no overrides, pre-tier behavior).
      const txGasTierRaw = process.env.TX_GAS_TIER?.toLowerCase();
      const validTiers = ['slow', 'normal', 'fast'] as const;
      type GasTier = (typeof validTiers)[number];
      if (txGasTierRaw && !(validTiers as readonly string[]).includes(txGasTierRaw)) {
        throw new Error(`Invalid TX_GAS_TIER: ${process.env.TX_GAS_TIER}. Supported: ${validTiers.join(', ')}`);
      }
      const txGasTier = txGasTierRaw as GasTier | undefined;

      const finP2PContract = await FinP2PContract.create(
        provider,
        signer,
        finP2PContractAddress,
        logger,
        txConfirmationTimeoutMs,
        txGasTier,
      );
      const finP2PClient = new FinP2PClient(finP2PUrl, ossUrl);
      const execDetailsStore = new InMemoryExecDetailsStore();
      const proofProvider = new ProofProvider(orgId, finP2PClient, operatorPrivateKey)

      const contractVersion = await finP2PContract.getVersion();
      logger.info(`FinP2P contract version: ${contractVersion} (variant: ${finP2PContract.variant})`);

      const defaultAssetStandardRaw = process.env.DEFAULT_ASSET_STANDARD ?? DEFAULT_ASSET_STANDARD_ERC20;
      if (!/^0x[0-9a-fA-F]{64}$/.test(defaultAssetStandardRaw)) {
        throw new Error(`Invalid DEFAULT_ASSET_STANDARD: must be a 0x-prefixed 32-byte hex string (66 chars), got ${defaultAssetStandardRaw}`);
      }
      if (!process.env.DEFAULT_ASSET_STANDARD) {
        logger.info(`DEFAULT_ASSET_STANDARD not set; defaulting to keccak256("ERC20") = ${DEFAULT_ASSET_STANDARD_ERC20}`);
      }
      if (finP2PContract.variant === 'with-registry') {
        await verifyAssetStandardRegistered(provider, finP2PContractAddress, defaultAssetStandardRaw, logger);
      }

      const { name, version, chainId, verifyingContract } =
        await finP2PContract.eip712Domain();
      logger.info(
        `EIP712 domain: name=${name} version=${version} chainId=${chainId} verifyingContract=${verifyingContract}`
      );

      // v2 plan-based operator: FINP2P_CONTRACT_VERSION=2 switches the services
      // to plan-mirrored execution; the v1 contract stays as fallback for
      // standalone (non-plan) operations.
      const finP2PContractVersionRaw = process.env.FINP2P_CONTRACT_VERSION ?? '1';
      if (finP2PContractVersionRaw !== '1' && finP2PContractVersionRaw !== '2') {
        throw new Error(`Invalid FINP2P_CONTRACT_VERSION: ${finP2PContractVersionRaw}. Supported values: 1, 2`);
      }
      let orchestrator: FinP2POrchestratorContract | undefined;
      if (finP2PContractVersionRaw === '2') {
        const orchestratorAddress = process.env.FINP2P_ORCHESTRATOR_ADDRESS;
        if (!orchestratorAddress) {
          throw new Error("FINP2P_ORCHESTRATOR_ADDRESS is not set (required when FINP2P_CONTRACT_VERSION=2)");
        }
        orchestrator = new FinP2POrchestratorContract(
          provider,
          signer,
          orchestratorAddress,
          logger,
          txConfirmationTimeoutMs,
          txGasTier,
        );
        const planVersion = await orchestrator.getVersion();
        const escrowAddress = await orchestrator.getEscrowAddress();
        logger.info(`FinP2P plan contract version: ${planVersion} at ${orchestratorAddress}, escrow at ${escrowAddress}`);
      }

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
        defaultAssetStandard: defaultAssetStandardRaw,
        orchestrator,
      }
    }
    case 'fireblocks': {
      return { ...await createFireblocksAppConfig(), accountMappingType, accountModel, escrowProvider, escrowContractAddress }
    }
    case 'dfns': {
      return { ...await createDfnsAppConfig(), accountMappingType, accountModel, escrowProvider, escrowContractAddress }
    }
    default: {
      // For registry-based providers: return generic config.
      // The provider factory reads its own env vars.
      const orgId = process.env.ORGANIZATION_ID || '';
      const rpcUrl = getNetworkRpcUrl();
      const provider = new JsonRpcProvider(rpcUrl);
      return {
        type: configType,
        orgId,
        provider,
        signer: provider as any, // Provider-factory will set up the real signer
        finP2PClient: undefined,
        proofProvider: undefined,
        accountMappingType,
        accountModel,
        escrowProvider,
        escrowContractAddress,
      } as CustodyAppConfig;
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

/**
 * AssetRegistry reverts with "Asset standard not found" for unknown ids
 * (NOT zero address) — we catch that specific revert and translate to a
 * clear error so a typo'd DEFAULT_ASSET_STANDARD fails fast at boot
 * instead of at the first createAsset call.
 */
export async function verifyAssetStandardRegistered(
  provider: Provider,
  operatorAddress: string,
  assetStandard: string,
  logger: Logger,
): Promise<void> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(assetStandard)) {
    throw new Error(`Invalid asset standard: must be a 0x-prefixed 32-byte hex string (66 chars), got ${assetStandard}`);
  }

  const operatorIface = new Interface(["function getAssetRegistry() view returns (address)"]);
  const registryIface = new Interface(["function getAssetStandard(bytes32) view returns (address)"]);

  const registryResult = await provider.call({
    to: operatorAddress,
    data: operatorIface.encodeFunctionData("getAssetRegistry", []),
  });
  const [registryAddress] = operatorIface.decodeFunctionResult("getAssetRegistry", registryResult);
  if (registryAddress === ZeroAddress) {
    throw new Error(`FINP2POperatorWithRegistry at ${operatorAddress} returned zero address for its AssetRegistry — contract is misconfigured.`);
  }

  let standardImpl: string;
  try {
    const standardResult = await provider.call({
      to: registryAddress,
      data: registryIface.encodeFunctionData("getAssetStandard", [assetStandard]),
    });
    [standardImpl] = registryIface.decodeFunctionResult("getAssetStandard", standardResult);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Asset standard not found/.test(msg)) {
      throw new Error(`Asset standard ${assetStandard} is not registered on AssetRegistry ${registryAddress}. Register it on-chain first or use a known standard id.`);
    }
    throw e;
  }

  if (standardImpl === ZeroAddress) {
    // Defensive: shouldn't be reachable given the revert above, but keep the
    // check in case the registry contract is ever changed to return zero.
    throw new Error(`Asset standard ${assetStandard} resolves to zero address on AssetRegistry ${registryAddress}.`);
  }

  logger.info(`Asset standard ${assetStandard} verified on AssetRegistry ${registryAddress} → impl ${standardImpl}`);
}
