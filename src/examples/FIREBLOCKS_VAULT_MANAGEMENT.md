# Fireblocks Dynamic Vault Management

This document describes the new dynamic vault management features added to the Fireblocks configuration.

## Overview

Previously, the Fireblocks configuration required vault IDs to be specified upfront through the `FIREBLOCKS_VAULT_ACCOUNT_IDS` environment variable. While this is still required for the initial Web3 provider setup, the configuration now includes methods to dynamically discover all available vaults and map Ethereum addresses to their corresponding vaults.

## New Types

### FireblocksVaultAccount

Represents a Fireblocks vault account with its metadata:

```typescript
type FireblocksVaultAccount = {
  id: string;                      // Unique vault identifier
  name: string;                    // Human-readable vault name
  assets: FireblocksVaultAsset[];  // List of assets in this vault
  hiddenOnUI?: boolean;            // Whether vault is hidden in Fireblocks console
  customerRefId?: string;          // Custom reference ID
  autoFuel?: boolean;              // Auto-fuel status
}
```

### FireblocksVaultAsset

Represents a single asset (blockchain address) within a vault:

```typescript
type FireblocksVaultAsset = {
  assetId: string;            // Blockchain identifier (e.g., "ETH", "ETH_TEST3")
  address: string;            // Public blockchain address
  legacyAddress?: string;     // Legacy address format
  balance?: string;           // Current balance
  availableBalance?: string;  // Available balance (excluding locked funds)
  lockedBalance?: string;     // Locked balance
  tag?: string;               // Address tag/memo
}
```

### EthereumAddressToVaultMapping

Quick lookup structure for address-to-vault mapping:

```typescript
type EthereumAddressToVaultMapping = {
  [address: string]: {
    vaultId: string;
    assetId: string;
  }
}
```

## New FireblocksAppConfig Methods

The `FireblocksAppConfig` type now includes four new methods:

### 1. getAllVaults()

Fetches all vault accounts from Fireblocks API.

```typescript
const vaults = await config.getAllVaults();
console.log(`Found ${vaults.length} vaults`);
```

**Features:**
- Returns complete vault information including all assets
- Results are cached after first call for performance
- Handles pagination automatically

### 2. getVaultIdByAddress(ethereumAddress)

Finds which vault owns a specific Ethereum address.

```typescript
const vaultInfo = await config.getVaultIdByAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");
if (vaultInfo) {
  console.log(`Address belongs to vault ${vaultInfo.vaultId}`);
}
```

**Features:**
- Case-insensitive address matching
- Returns `undefined` if address not found
- Useful for identifying vault from transaction address

### 3. getEthereumVaults()

Gets only vaults containing Ethereum assets (filters out BTC, etc.).

```typescript
const ethVaults = await config.getEthereumVaults();
const addresses = ethVaults.flatMap(v => v.assets.map(a => a.address));
```

**Features:**
- Filters for assets with IDs starting with "ETH"
- Returns only vaults that have at least one ETH asset
- Optimized for Ethereum-focused applications

### 4. getAddressToVaultMapping()

Creates a lookup table for fast batch address resolution.

```typescript
const mapping = await config.getAddressToVaultMapping();
const vaultInfo = mapping["0x742d35cc6634c0532925a3b844bc9e7595f0beb"];
```

**Features:**
- Creates comprehensive address-to-vault mapping
- Cached for performance
- Uses lowercase addresses for case-insensitive lookups
- Ideal for batch operations

## Usage Examples

### Basic Vault Discovery

```typescript
import { envVarsToAppConfig } from './config';

const config = await envVarsToAppConfig(logger);

if (config.type === 'fireblocks') {
  // Get all vaults
  const vaults = await config.getAllVaults();
  
  // Print vault summary
  for (const vault of vaults) {
    console.log(`Vault ${vault.id}: ${vault.name}`);
    console.log(`  Assets: ${vault.assets.length}`);
    
    const ethAssets = vault.assets.filter(a => a.assetId.startsWith('ETH'));
    console.log(`  Ethereum assets: ${ethAssets.length}`);
  }
}
```

### Address-to-Vault Lookup

```typescript
if (config.type === 'fireblocks') {
  const senderAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb";
  
  const vaultInfo = await config.getVaultIdByAddress(senderAddress);
  
  if (vaultInfo) {
    console.log(`Using vault ${vaultInfo.vaultId} for transaction`);
    // Proceed with transaction
  } else {
    throw new Error('Address not found in any vault');
  }
}
```

### Batch Address Processing

```typescript
if (config.type === 'fireblocks') {
  // Create mapping once
  const mapping = await config.getAddressToVaultMapping();
  
  // Process multiple addresses efficiently
  const addresses = [
    "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "0xE5D89547c9F46c6F8e506a21d2BEe51bb1e7b50A"
  ];
  
  for (const address of addresses) {
    const vaultInfo = mapping[address.toLowerCase()];
    if (vaultInfo) {
      console.log(`${address} -> Vault ${vaultInfo.vaultId}`);
    }
  }
}
```

## Implementation Details

### Caching Strategy

The implementation uses a caching strategy to minimize API calls:

1. **First call**: Fetches all vaults from Fireblocks API
2. **Subsequent calls**: Returns cached data
3. **Cache reset**: Create a new config instance to refresh data

This is important because Fireblocks API has rate limits.

### Error Handling

All methods properly handle errors and provide meaningful error messages:

```typescript
try {
  const vaults = await config.getAllVaults();
} catch (error) {
  console.error('Failed to fetch vaults:', error);
  // Check FIREBLOCKS_API_KEY and FIREBLOCKS_API_PRIVATE_KEY_PATH
}
```

### API Integration

The implementation uses the Fireblocks SDK's `getVaultAccountsWithPageInfo()` method, which:
- Handles pagination automatically
- Returns complete vault information
- Includes all assets for each vault

## Environment Variables

The following environment variables are still required:

- `FIREBLOCKS_API_KEY`: Your Fireblocks API key
- `FIREBLOCKS_API_PRIVATE_KEY_PATH`: Path to your Fireblocks private key file
- `FIREBLOCKS_VAULT_ACCOUNT_IDS`: Comma-separated vault IDs for Web3 provider (e.g., "0,1,2")
- `FIREBLOCKS_CHAIN_ID`: (Optional) Chain ID (defaults to MAINNET)
- `FIREBLOCKS_API_BASE_URL`: (Optional) API base URL (defaults to Production)

## Future Enhancements

Potential improvements for future versions:

1. **Optional Vault IDs**: Make `FIREBLOCKS_VAULT_ACCOUNT_IDS` optional by auto-discovering the first available vault
2. **Vault Filtering**: Add methods to filter vaults by balance, asset type, or custom criteria
3. **Real-time Updates**: Implement webhooks or polling for vault balance updates
4. **Transaction History**: Add methods to fetch transaction history for specific vaults
5. **Multi-chain Support**: Extend address-to-vault mapping for other blockchains (BTC, SOL, etc.)

## Troubleshooting

### No vaults found
- Check your API key and private key path
- Verify your Fireblocks account has vaults created
- Ensure API permissions include vault access

### Address not found
- Verify the address is correct and checksummed properly
- Ensure the vault has been activated for Ethereum
- Check that assets have been created in the vault

### API rate limits
- The caching mechanism helps avoid rate limits
- If needed, implement additional caching at application level
- Consider the Fireblocks API rate limits in your architecture

## See Also

- [Fireblocks API Documentation](https://docs.fireblocks.com/api/swagger-ui/)
- [Example Code](./fireblocks-vault-management.example.ts)
- [Main Configuration](../config.ts)
