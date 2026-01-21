import { FireblocksSDK } from "fireblocks-sdk";

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
export const createVaultManagementFunctions = (fireblocksSdk: FireblocksSDK) => {
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
