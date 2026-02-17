import * as dotenv from "dotenv";
import * as fs from "fs";
import { resolve } from "node:path";
import { FireblocksSDK } from "fireblocks-sdk";
import { ApiBaseUrl } from "@fireblocks/fireblocks-web3-provider";

dotenv.config({ path: resolve(process.cwd(), ".env.fireblocks") });

const run = async () => {
  const apiKey = process.env.FIREBLOCKS_API_KEY!;
  const apiPrivateKey = fs.readFileSync(process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH!, "utf-8");
  const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as string;

  const sdk = new FireblocksSDK(apiPrivateKey, apiKey, apiBaseUrl);

  // 1. Create a new vault account for testing
  const vaultName = "finp2p-adapter-test";
  console.log(`Creating vault "${vaultName}"...`);
  const vault = await sdk.createVaultAccount(vaultName);
  console.log(`Vault created: id=${vault.id} name="${vault.name}"`);

  // 2. Create ETH_TEST5 (Sepolia ETH) asset in the vault to get a deposit address
  console.log("\nActivating ETH_TEST5 (Sepolia ETH)...");
  const ethAsset = await sdk.createVaultAsset(vault.id, "ETH_TEST5");
  console.log(`  ETH_TEST5 address: ${ethAsset.address}`);

  // 3. Also activate USDC on Sepolia
  console.log("\nActivating USDC_ETH_TEST5_0GER (USDC on Sepolia)...");
  const usdcAsset = await sdk.createVaultAsset(vault.id, "USDC_ETH_TEST5_0GER");
  console.log(`  USDC address: ${usdcAsset.address}`);

  console.log("\n=== Summary ===");
  console.log(`Vault ID: ${vault.id}`);
  console.log(`Vault Name: ${vault.name}`);
  console.log(`Sepolia deposit address: ${ethAsset.address}`);
  console.log(`\nFund this address with Sepolia ETH: ${ethAsset.address}`);
  console.log(`\nUpdate .env.fireblocks with: FIREBLOCKS_VAULT_ID=${vault.id}`);
};

run().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
