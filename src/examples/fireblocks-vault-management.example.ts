/**
 * Example file demonstrating how to use the dynamic vault management features
 * added to the Fireblocks configuration.
 * 
 * This file is NOT meant to be compiled or run directly - it's documentation
 * showing how developers should use the new vault management APIs.
 * 
 * IMPORTANT: This code will not compile until dependencies are properly installed.
 * This is expected per the requirements.
 */

import { FireblocksAppConfig } from '../config';

/**
 * Example 1: Fetching all vaults
 * 
 * This shows how to retrieve all vault accounts from Fireblocks
 * and iterate through them to see their assets and addresses.
 */
async function example1_getAllVaults(config: FireblocksAppConfig) {
  console.log('=== Example 1: Get All Vaults ===');
  
  // Fetch all vaults dynamically
  const vaults = await config.getAllVaults();
  
  console.log(`Found ${vaults.length} vaults`);
  
  // Iterate through each vault
  for (const vault of vaults) {
    console.log(`\nVault ID: ${vault.id}`);
    console.log(`  Name: ${vault.name}`);
    console.log(`  Hidden: ${vault.hiddenOnUI ? 'Yes' : 'No'}`);
    console.log(`  Assets: ${vault.assets.length}`);
    
    // Show details for each asset in the vault
    for (const asset of vault.assets) {
      console.log(`    - ${asset.assetId}: ${asset.address}`);
      if (asset.balance) {
        console.log(`      Balance: ${asset.balance}`);
      }
      if (asset.availableBalance) {
        console.log(`      Available: ${asset.availableBalance}`);
      }
    }
  }
}

/**
 * Example 2: Finding a vault by Ethereum address
 * 
 * This shows how to look up which vault owns a specific Ethereum address.
 * This is useful when you receive a transaction and need to identify the vault.
 */
async function example2_findVaultByAddress(config: FireblocksAppConfig) {
  console.log('\n=== Example 2: Find Vault by Address ===');
  
  // Example Ethereum address (replace with actual address)
  const ethereumAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb";
  
  // Look up the vault that owns this address
  const vaultInfo = await config.getVaultIdByAddress(ethereumAddress);
  
  if (vaultInfo) {
    console.log(`Address ${ethereumAddress} belongs to:`);
    console.log(`  Vault ID: ${vaultInfo.vaultId}`);
    console.log(`  Asset ID: ${vaultInfo.assetId}`);
    
    // You can now use this vault ID for transactions
    console.log(`\nYou can use vault ${vaultInfo.vaultId} for operations with this address`);
  } else {
    console.log(`Address ${ethereumAddress} not found in any vault`);
  }
}

/**
 * Example 3: Getting only Ethereum vaults
 * 
 * This filters out non-Ethereum assets and returns only vaults
 * that contain Ethereum addresses.
 */
async function example3_getEthereumVaults(config: FireblocksAppConfig) {
  console.log('\n=== Example 3: Get Ethereum-Only Vaults ===');
  
  // Get only vaults with Ethereum assets
  const ethVaults = await config.getEthereumVaults();
  
  console.log(`Found ${ethVaults.length} vaults with Ethereum assets`);
  
  // Collect all Ethereum addresses
  const allEthAddresses = ethVaults.flatMap(vault => 
    vault.assets.map(asset => ({
      vaultId: vault.id,
      vaultName: vault.name,
      assetId: asset.assetId,
      address: asset.address
    }))
  );
  
  console.log(`Total Ethereum addresses: ${allEthAddresses.length}`);
  
  // Display all Ethereum addresses
  allEthAddresses.forEach(item => {
    console.log(`  Vault ${item.vaultId} (${item.vaultName}): ${item.address} [${item.assetId}]`);
  });
}

/**
 * Example 4: Using the address-to-vault mapping for batch operations
 * 
 * This creates a lookup table for fast address-to-vault resolution,
 * which is useful when processing multiple addresses.
 */
async function example4_addressToVaultMapping(config: FireblocksAppConfig) {
  console.log('\n=== Example 4: Address-to-Vault Mapping ===');
  
  // Create the mapping (cached for performance)
  const mapping = await config.getAddressToVaultMapping();
  
  console.log(`Created mapping for ${Object.keys(mapping).length} addresses`);
  
  // Example: Check multiple addresses quickly
  const addressesToCheck = [
    "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "0xE5D89547c9F46c6F8e506a21d2BEe51bb1e7b50A",
    "0x1234567890123456789012345678901234567890"
  ];
  
  console.log('\nChecking multiple addresses:');
  for (const address of addressesToCheck) {
    const normalizedAddress = address.toLowerCase();
    const vaultInfo = mapping[normalizedAddress];
    
    if (vaultInfo) {
      console.log(`  ${address} -> Vault ${vaultInfo.vaultId} (${vaultInfo.assetId})`);
    } else {
      console.log(`  ${address} -> Not found`);
    }
  }
}

/**
 * Example 5: Determining available vaults for a transaction
 * 
 * This shows how to check if a specific vault has sufficient funds
 * and is available for transactions.
 */
async function example5_checkVaultAvailability(config: FireblocksAppConfig) {
  console.log('\n=== Example 5: Check Vault Availability ===');
  
  const vaults = await config.getAllVaults();
  
  console.log('Checking vault availability for Ethereum transactions:\n');
  
  for (const vault of vaults) {
    // Filter for Ethereum assets
    const ethAssets = vault.assets.filter(asset => asset.assetId.startsWith('ETH'));
    
    if (ethAssets.length > 0) {
      console.log(`Vault ${vault.id} (${vault.name}):`);
      
      for (const asset of ethAssets) {
        const hasBalance = asset.balance && parseFloat(asset.balance) > 0;
        const hasAvailable = asset.availableBalance && parseFloat(asset.availableBalance) > 0;
        
        console.log(`  ${asset.assetId}:`);
        console.log(`    Address: ${asset.address}`);
        console.log(`    Balance: ${asset.balance || '0'}`);
        console.log(`    Available: ${asset.availableBalance || '0'}`);
        console.log(`    Status: ${hasAvailable ? '✓ Ready' : '✗ No funds'}`);
      }
      console.log();
    }
  }
}

/**
 * Example 6: Integration with existing code
 * 
 * This shows how to integrate the new vault management features
 * with existing transaction logic.
 */
async function example6_integrationPattern(config: FireblocksAppConfig) {
  console.log('\n=== Example 6: Integration Pattern ===');
  
  // Scenario: User wants to send a transaction from a specific address
  const senderAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb";
  
  // Step 1: Find which vault owns this address
  const vaultInfo = await config.getVaultIdByAddress(senderAddress);
  
  if (!vaultInfo) {
    throw new Error(`Address ${senderAddress} not found in any vault`);
  }
  
  console.log(`Transaction will use vault ${vaultInfo.vaultId}`);
  
  // Step 2: Get full vault details to check availability
  const allVaults = await config.getAllVaults();
  const vault = allVaults.find(v => v.id === vaultInfo.vaultId);
  
  if (!vault) {
    throw new Error(`Vault ${vaultInfo.vaultId} not found`);
  }
  
  // Step 3: Find the specific asset
  const asset = vault.assets.find(a => a.assetId === vaultInfo.assetId);
  
  if (!asset) {
    throw new Error(`Asset ${vaultInfo.assetId} not found in vault ${vaultInfo.vaultId}`);
  }
  
  // Step 4: Check if funds are available
  const availableBalance = parseFloat(asset.availableBalance || '0');
  const requiredAmount = 0.1; // Example: 0.1 ETH
  
  if (availableBalance < requiredAmount) {
    throw new Error(`Insufficient balance: have ${availableBalance}, need ${requiredAmount}`);
  }
  
  console.log(`✓ Vault ${vaultInfo.vaultId} is ready for transaction`);
  console.log(`  Address: ${asset.address}`);
  console.log(`  Available balance: ${asset.availableBalance}`);
  
  // Now you can proceed with the transaction using config.provider and config.signer
  // The provider is already configured with the correct vault IDs
}

/**
 * Example 7: Error handling and edge cases
 * 
 * This demonstrates proper error handling when working with vaults.
 */
async function example7_errorHandling(config: FireblocksAppConfig) {
  console.log('\n=== Example 7: Error Handling ===');
  
  try {
    // Attempt to fetch vaults
    const vaults = await config.getAllVaults();
    
    if (vaults.length === 0) {
      console.warn('Warning: No vaults found. Check Fireblocks API access.');
      return;
    }
    
    // Check for vaults without Ethereum assets
    const vaultsWithoutEth = vaults.filter(vault => 
      !vault.assets.some(asset => asset.assetId.startsWith('ETH'))
    );
    
    if (vaultsWithoutEth.length > 0) {
      console.log(`Found ${vaultsWithoutEth.length} vaults without Ethereum assets`);
    }
    
    // Example: Handle case-insensitive address lookup
    const addressVariations = [
      "0xABC123",
      "0xabc123",
      "0xAbC123"
    ];
    
    console.log('\nTesting case-insensitive address lookup:');
    const results = await Promise.all(
      addressVariations.map(addr => config.getVaultIdByAddress(addr))
    );
    
    // All variations should return the same result
    const allSame = results.every(r => JSON.stringify(r) === JSON.stringify(results[0]));
    console.log(`Case-insensitive lookup working: ${allSame ? '✓' : '✗'}`);
    
  } catch (error) {
    console.error('Error accessing Fireblocks API:', error);
    
    // Provide helpful error messages
    if (error instanceof Error) {
      if (error.message.includes('API')) {
        console.error('Hint: Check your FIREBLOCKS_API_KEY and FIREBLOCKS_API_PRIVATE_KEY_PATH');
      } else if (error.message.includes('network')) {
        console.error('Hint: Check your internet connection and FIREBLOCKS_API_BASE_URL');
      }
    }
    
    throw error;
  }
}

/**
 * Main function to run all examples
 * 
 * Note: This is just for demonstration and won't actually run
 * until proper configuration is provided.
 */
export async function demonstrateVaultManagement(config: FireblocksAppConfig) {
  console.log('='.repeat(60));
  console.log('Fireblocks Vault Management Examples');
  console.log('='.repeat(60));
  
  await example1_getAllVaults(config);
  await example2_findVaultByAddress(config);
  await example3_getEthereumVaults(config);
  await example4_addressToVaultMapping(config);
  await example5_checkVaultAvailability(config);
  await example6_integrationPattern(config);
  await example7_errorHandling(config);
  
  console.log('\n' + '='.repeat(60));
  console.log('All examples completed!');
  console.log('='.repeat(60));
}

/**
 * Usage in production code:
 * 
 * import { envVarsToAppConfig } from './config';
 * import { demonstrateVaultManagement } from './examples/fireblocks-vault-management.example';
 * 
 * // In your application
 * const config = await envVarsToAppConfig(logger);
 * if (config.type === 'fireblocks') {
 *   // Use the vault management features
 *   const vaults = await config.getAllVaults();
 *   const mapping = await config.getAddressToVaultMapping();
 *   
 *   // Or run the examples
 *   await demonstrateVaultManagement(config);
 * }
 */
