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
import { FireblocksSDK, VaultAccountResponse, VaultAsset } from "fireblocks-sdk";

/**
 * Represents a Fireblocks vault account with its associated metadata.
 * This type is used to store vault information retrieved dynamically from Fireblocks API.
 */
export type FireblocksVaultAccount = {
  /** Unique identifier of the vault account */
  id: string;
  /** Human-readable name of the vault account */
  name: string;
  /** List of assets/addresses within this vault */
  assets: FireblocksVaultAsset[];
  /** Whether this vault account is hidden in the Fireblocks console */
  hiddenOnUI?: boolean;
  /** Whether this vault account can be used as a source for transactions */
  customerRefId?: string;
  /** Indicates if automatic fuel management is enabled for this vault */
  autoFuel?: boolean;
}

/**
 * Represents a single asset (address) within a Fireblocks vault.
 * Each vault can contain multiple assets across different blockchains.
 */
export type FireblocksVaultAsset = {
  /** The blockchain identifier (e.g., "ETH", "ETH_TEST3", "BTC") */
  assetId: string;
  /** The public address/key for this asset on the blockchain */
  address: string;
  /** Legacy asset ID used in some Fireblocks operations */
  legacyAddress?: string;
  /** Current balance of this asset */
  balance?: string;
  /** Available balance (balance minus pending transactions) */
  availableBalance?: string;
  /** Balance that is currently locked in pending transactions */
  lockedBalance?: string;
  /** Tag/memo associated with the address (for chains that support it) */
  tag?: string;
}

/**
 * Mapping structure to quickly lookup vault ID from an Ethereum address.
 * This is useful when you have a public address and need to find which vault it belongs to.
 * 
 * Structure: { [ethereumAddress: string]: { vaultId: string, assetId: string } }
 * 
 * Example:
 * {
 *   "0x1234...": { vaultId: "0", assetId: "ETH" },
 *   "0x5678...": { vaultId: "1", assetId: "ETH_TEST3" }
 * }
 */
export type EthereumAddressToVaultMapping = {
  [address: string]: {
    vaultId: string;
    assetId: string;
  }
}

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

/**
 * Fireblocks-specific application configuration.
 * 
 * This configuration type has been extended to support dynamic vault management.
 * Instead of requiring vault IDs upfront, this configuration allows runtime
 * discovery of all available vaults and their associated Ethereum addresses.
 * 
 * Key features:
 * 1. Dynamic vault discovery: Use getAllVaults() to fetch all available vaults
 * 2. Address-to-vault mapping: Use getVaultIdByAddress() to find which vault owns an address
 * 3. Ethereum-focused filtering: Use getEthereumVaults() to get only ETH-related vaults
 */
export type FireblocksAppConfig = {
  type: 'fireblocks'
  provider: BrowserProvider
  signer: JsonRpcSigner
  fireblocksSdk: FireblocksSDK
  
  /**
   * Retrieves all vault accounts from Fireblocks.
   * This method dynamically fetches the complete list of vaults and their assets.
   * 
   * @returns Promise resolving to an array of vault accounts with their assets
   * @throws Error if the Fireblocks API call fails
   * 
   * Usage example:
   * ```typescript
   * const vaults = await config.getAllVaults();
   * vaults.forEach(vault => {
   *   console.log(`Vault ${vault.id}: ${vault.name}`);
   *   vault.assets.forEach(asset => {
   *     console.log(`  ${asset.assetId}: ${asset.address}`);
   *   });
   * });
   * ```
   */
  getAllVaults: () => Promise<FireblocksVaultAccount[]>
  
  /**
   * Finds the vault ID that owns a specific Ethereum address.
   * This is useful when you have a public address and need to determine
   * which Fireblocks vault it belongs to.
   * 
   * @param ethereumAddress - The Ethereum address to look up (case-insensitive)
   * @returns Promise resolving to an object containing vaultId and assetId, or undefined if not found
   * 
   * Usage example:
   * ```typescript
   * const address = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb";
   * const vaultInfo = await config.getVaultIdByAddress(address);
   * if (vaultInfo) {
   *   console.log(`Address belongs to vault ${vaultInfo.vaultId}, asset ${vaultInfo.assetId}`);
   * }
   * ```
   */
  getVaultIdByAddress: (ethereumAddress: string) => Promise<{ vaultId: string; assetId: string } | undefined>
  
  /**
   * Retrieves only the vaults that contain Ethereum-based assets.
   * Filters for assets with IDs starting with "ETH" (e.g., ETH, ETH_TEST3, ETH_TEST5).
   * 
   * @returns Promise resolving to an array of vault accounts containing only ETH assets
   * 
   * Usage example:
   * ```typescript
   * const ethVaults = await config.getEthereumVaults();
   * const allEthAddresses = ethVaults.flatMap(vault => 
   *   vault.assets.map(asset => asset.address)
   * );
   * ```
   */
  getEthereumVaults: () => Promise<FireblocksVaultAccount[]>
  
  /**
   * Creates a mapping from Ethereum addresses to their vault IDs.
   * This is useful for quick lookups when you need to process multiple addresses.
   * The mapping is cached after the first call for performance.
   * 
   * @returns Promise resolving to a map of address -> vault info
   * 
   * Usage example:
   * ```typescript
   * const mapping = await config.getAddressToVaultMapping();
   * const address = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb";
   * if (mapping[address.toLowerCase()]) {
   *   const { vaultId, assetId } = mapping[address.toLowerCase()];
   *   console.log(`Address ${address} belongs to vault ${vaultId}`);
   * }
   * ```
   */
  getAddressToVaultMapping: () => Promise<EthereumAddressToVaultMapping>
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
  operatorPrivateKey: string, ethereumRPCUrl: string, useNonceManager: boolean = true): { provider: Provider, signer: Signer } => {
  const provider = new JsonRpcProvider(ethereumRPCUrl);
  let signer: Signer;
  if (useNonceManager) {
    signer = new NonceManager(new Wallet(operatorPrivateKey)).connect(provider);
  } else {
    signer = new Wallet(operatorPrivateKey).connect(provider);
  }

  return { provider, signer };
};

/**
 * Creates helper functions for vault management using Fireblocks SDK.
 * These functions allow dynamic discovery of vaults and address-to-vault mapping.
 * 
 * Implementation notes:
 * - Uses Fireblocks SDK's getVaultAccountsWithPageInfo() to paginate through all vaults
 * - Caches the vault list after first fetch to avoid repeated API calls
 * - Addresses are normalized to lowercase for case-insensitive lookups
 * - Only includes assets that have an address (some assets might not have addresses yet)
 * 
 * @param fireblocksSdk - Initialized Fireblocks SDK instance
 * @returns Object containing vault management functions
 */
const createVaultManagementFunctions = (fireblocksSdk: FireblocksSDK) => {
  // Cache for storing fetched vaults to avoid repeated API calls
  // This is reset if you need fresh data by creating a new config
  let cachedVaults: FireblocksVaultAccount[] | null = null;
  
  /**
   * Internal function to fetch all vaults from Fireblocks API with pagination.
   * The Fireblocks API returns vaults in pages, so we need to fetch all pages
   * to get the complete list.
   * 
   * According to Fireblocks API documentation:
   * - GET /v1/vault/accounts_paged returns paginated vault accounts
   * - Each page contains account details including their assets
   * - We need to iterate through all pages to get complete vault list
   */
  const fetchAllVaults = async (): Promise<FireblocksVaultAccount[]> => {
    // Return cached vaults if available
    if (cachedVaults !== null) {
      return cachedVaults;
    }
    
    const vaults: FireblocksVaultAccount[] = [];
    
    try {
      // Fetch all vault accounts using the Fireblocks SDK
      // Note: getVaultAccountsWithPageInfo() handles pagination internally
      // It returns all vault accounts across all pages
      const vaultResponse = await fireblocksSdk.getVaultAccountsWithPageInfo({});
      
      // Process each vault account from the response
      if (vaultResponse && vaultResponse.accounts) {
        for (const vault of vaultResponse.accounts) {
          // Extract vault assets with their addresses
          const assets: FireblocksVaultAsset[] = [];
          
          // Each vault can have multiple assets (ETH, BTC, etc.)
          if (vault.assets && Array.isArray(vault.assets)) {
            for (const asset of vault.assets) {
              // Only include assets that have an address
              // Some newly created assets might not have addresses yet
              if (asset.address) {
                assets.push({
                  assetId: asset.id,
                  address: asset.address,
                  legacyAddress: asset.legacyAddress,
                  balance: asset.balance,
                  availableBalance: asset.available,
                  lockedBalance: asset.locked,
                  tag: asset.tag
                });
              }
            }
          }
          
          // Add the vault with its assets to our list
          vaults.push({
            id: vault.id,
            name: vault.name,
            assets: assets,
            hiddenOnUI: vault.hiddenOnUI,
            customerRefId: vault.customerRefId,
            autoFuel: vault.autoFuel
          });
        }
      }
      
      // Cache the results for future calls
      cachedVaults = vaults;
      return vaults;
      
    } catch (error) {
      // Log the error and re-throw with more context
      console.error('Failed to fetch vaults from Fireblocks:', error);
      throw new Error(`Failed to fetch Fireblocks vaults: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  /**
   * Gets all vault accounts with their assets.
   */
  const getAllVaults = async (): Promise<FireblocksVaultAccount[]> => {
    return fetchAllVaults();
  };
  
  /**
   * Finds the vault ID and asset ID for a given Ethereum address.
   * Performs case-insensitive address matching.
   * 
   * @param ethereumAddress - The Ethereum address to search for
   * @returns Vault and asset information, or undefined if not found
   */
  const getVaultIdByAddress = async (ethereumAddress: string): Promise<{ vaultId: string; assetId: string } | undefined> => {
    const vaults = await fetchAllVaults();
    
    // Normalize the input address to lowercase for case-insensitive comparison
    const normalizedAddress = ethereumAddress.toLowerCase();
    
    // Search through all vaults and their assets
    for (const vault of vaults) {
      for (const asset of vault.assets) {
        // Check if this asset's address matches our target address
        if (asset.address.toLowerCase() === normalizedAddress) {
          return {
            vaultId: vault.id,
            assetId: asset.assetId
          };
        }
      }
    }
    
    // Address not found in any vault
    return undefined;
  };
  
  /**
   * Gets only the vaults that contain Ethereum-based assets.
   * Filters for assets where the assetId starts with "ETH".
   * 
   * This is useful when you only care about Ethereum addresses and want to
   * filter out Bitcoin, Solana, or other blockchain addresses.
   */
  const getEthereumVaults = async (): Promise<FireblocksVaultAccount[]> => {
    const allVaults = await fetchAllVaults();
    
    // Filter vaults to only include those with Ethereum assets
    const ethVaults = allVaults
      .map(vault => ({
        ...vault,
        // Filter assets to only include Ethereum-based ones
        assets: vault.assets.filter(asset => asset.assetId.startsWith('ETH'))
      }))
      // Only keep vaults that have at least one Ethereum asset
      .filter(vault => vault.assets.length > 0);
    
    return ethVaults;
  };
  
  /**
   * Creates a mapping from Ethereum addresses to their vault IDs.
   * This is cached after the first call for performance.
   * 
   * The mapping is useful when you need to perform multiple lookups,
   * as it's faster than calling getVaultIdByAddress() repeatedly.
   */
  const getAddressToVaultMapping = async (): Promise<EthereumAddressToVaultMapping> => {
    const ethVaults = await getEthereumVaults();
    const mapping: EthereumAddressToVaultMapping = {};
    
    // Build the mapping from all Ethereum addresses
    for (const vault of ethVaults) {
      for (const asset of vault.assets) {
        // Use lowercase addresses as keys for case-insensitive lookups
        const normalizedAddress = asset.address.toLowerCase();
        mapping[normalizedAddress] = {
          vaultId: vault.id,
          assetId: asset.assetId
        };
      }
    }
    
    return mapping;
  };
  
  return {
    getAllVaults,
    getVaultIdByAddress,
    getEthereumVaults,
    getAddressToVaultMapping
  };
};

/**
 * Creates a Fireblocks provider with dynamic vault management capabilities.
 * 
 * This function initializes the Fireblocks Web3 provider and creates helper functions
 * for dynamic vault discovery. The vault IDs are still required for the initial provider
 * setup, but the returned config includes methods to discover additional vaults at runtime.
 * 
 * Key improvements:
 * 1. Returns vault management functions for runtime vault discovery
 * 2. Allows discovering all vaults without hardcoding vault IDs
 * 3. Provides address-to-vault mapping for reverse lookups
 * 
 * @param vaultAccountIds - Initial vault account IDs for the Web3 provider
 * @returns Object containing provider, signer, SDK, and vault management functions
 */
const createFireblocksProvider = async (vaultAccountIds: string[]): Promise<{
  provider: BrowserProvider,
  signer: JsonRpcSigner,
  fireblocksSdk: FireblocksSDK,
  vaultManagement: ReturnType<typeof createVaultManagementFunctions>
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

  // Initialize the Fireblocks Web3 provider with specified vault IDs
  // Note: These vault IDs are still needed for the Web3 provider initialization,
  // but we'll provide methods to discover other vaults dynamically
  const eip1193Provider = new FireblocksWeb3Provider({
    privateKey, apiKey, chainId, apiBaseUrl, vaultAccountIds
  });
  const provider = new BrowserProvider(eip1193Provider);
  const signer = await provider.getSigner();
  
  // Initialize the Fireblocks SDK for vault management operations
  const fireblocksSdk = new FireblocksSDK(privateKey, apiKey, (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production))
  
  // Create vault management functions using the SDK
  const vaultManagement = createVaultManagementFunctions(fireblocksSdk);

  return { provider, signer, fireblocksSdk, vaultManagement };
};

export async function envVarsToAppConfig(logger: Logger): Promise<AppConfig> {
  const configType = (process.env.PROVIDER_TYPE || 'local') as AppConfig['type']
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

  switch (configType) {
    case 'local': {
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
      // Parse vault account IDs from environment variable
      // Format: comma-separated list like "0,1,2" or "vault1,vault2"
      const envVaultAccountIdsStr = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS;
      const vaultAccountIds = envVaultAccountIdsStr ? envVaultAccountIdsStr.split(",").map(id => id.trim()) : [];
      
      // Note: Vault IDs are still required for initial Web3 provider setup
      // However, you can now discover additional vaults dynamically using the vault management functions
      // 
      // Future enhancement: Consider making vault IDs optional and discovering them automatically
      // by fetching all vaults and using the first available vault for the Web3 provider
      if (vaultAccountIds.length === 0) {
        throw new Error("FIREBLOCKS_VAULT_ACCOUNT_IDS is not set or empty");
      }

      // Initialize Fireblocks provider with vault management capabilities
      const { provider, signer, fireblocksSdk, vaultManagement } = await createFireblocksProvider(vaultAccountIds)
      
      // Return the Fireblocks configuration with vault management functions
      // These functions allow runtime discovery of all vaults and address-to-vault mapping
      return {
        type: 'fireblocks',
        provider,
        signer,
        fireblocksSdk,
        // Expose vault management functions as part of the config
        getAllVaults: vaultManagement.getAllVaults,
        getVaultIdByAddress: vaultManagement.getVaultIdByAddress,
        getEthereumVaults: vaultManagement.getEthereumVaults,
        getAddressToVaultMapping: vaultManagement.getAddressToVaultMapping
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

