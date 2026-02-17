import * as dotenv from "dotenv";
import * as fs from "fs";
import { resolve } from "node:path";
import { FireblocksSDK } from "fireblocks-sdk";
import { ApiBaseUrl, ChainId } from "@fireblocks/fireblocks-web3-provider";
import { createFireblocksEthersProvider } from "../src/config";
import { createVaultManagementFunctions } from "../src/vaults";

dotenv.config({ path: resolve(process.cwd(), ".env.fireblocks") });

const run = async () => {
  const apiKey = process.env.FIREBLOCKS_API_KEY!;
  const apiPrivateKey = fs.readFileSync(process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH!, "utf-8");
  const chainId = Number(process.env.FIREBLOCKS_CHAIN_ID!) as ChainId;
  const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as ApiBaseUrl;
  const vaultId = process.env.FIREBLOCKS_VAULT_ID!;

  console.log("=== Fireblocks Connection Probe ===\n");
  console.log(`API Key: ${apiKey.substring(0, 8)}...`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`API Base URL: ${apiBaseUrl}`);
  console.log(`Vault ID: ${vaultId}`);
  console.log();

  // 1. Test SDK connection - list vaults
  const sdk = new FireblocksSDK(apiPrivateKey, apiKey, apiBaseUrl as string);
  const vaultMgmt = createVaultManagementFunctions(sdk, { cacheValuesTtlMs: 3000 });

  console.log("--- Fetching vaults ---");
  const vaults = await vaultMgmt.fetchAllVaults();
  for (const vault of vaults) {
    console.log(`  Vault ${vault.id}: "${vault.name}"`);
    if (vault.assets && vault.assets.length > 0) {
      for (const asset of vault.assets) {
        console.log(`    Asset: ${asset.id} | balance: ${asset.balance} | available: ${asset.available}`);
      }
    } else {
      console.log(`    (no assets)`);
    }
  }
  console.log();

  // 2. Test ethers provider connection
  console.log("--- Testing ethers provider ---");
  const { provider, signer } = await createFireblocksEthersProvider({
    apiKey,
    privateKey: apiPrivateKey,
    chainId,
    apiBaseUrl,
    vaultAccountIds: [vaultId],
  });

  const network = await provider.getNetwork();
  console.log(`  Network: ${network.name} (chainId: ${network.chainId})`);

  const address = await signer.getAddress();
  console.log(`  Signer address: ${address}`);

  const ethBalance = await provider.getBalance(address);
  console.log(`  ETH balance: ${ethBalance.toString()} wei`);
  console.log();

  // 3. Check USDC on Sepolia (well-known address)
  const USDC_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  console.log(`--- Checking USDC at ${USDC_SEPOLIA} ---`);
  try {
    const erc20Abi = [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
      "function balanceOf(address) view returns (uint256)",
    ];
    const { ethers } = await import("ethers");
    const usdc = new ethers.Contract(USDC_SEPOLIA, erc20Abi, provider);
    const name = await usdc.name();
    const symbol = await usdc.symbol();
    const decimals = await usdc.decimals();
    const balance = await usdc.balanceOf(address);
    console.log(`  Token: ${name} (${symbol})`);
    console.log(`  Decimals: ${decimals}`);
    console.log(`  Balance of ${address}: ${balance.toString()} (${Number(balance) / 10 ** Number(decimals)} ${symbol})`);
  } catch (e: any) {
    console.log(`  Error reading USDC: ${e.message}`);
  }

  console.log("\n=== Probe complete ===");
};

run().catch((e) => {
  console.error("Probe failed:", e);
  process.exit(1);
});
