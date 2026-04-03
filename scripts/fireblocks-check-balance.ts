import * as dotenv from "dotenv";
import * as fs from "fs";
import { resolve } from "node:path";
import { FireblocksSDK } from "fireblocks-sdk";
import { ApiBaseUrl, ChainId } from "@fireblocks/fireblocks-web3-provider";
import { ethers } from "ethers";
import { JsonRpcProvider } from "ethers";

dotenv.config({ path: resolve(process.cwd(), ".env.fireblocks") });

const run = async () => {
  const apiKey = process.env.FIREBLOCKS_API_KEY!;
  const apiPrivateKey = fs.readFileSync(process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH!, "utf-8");
  const chainId = Number(process.env.FIREBLOCKS_CHAIN_ID!) as ChainId;
  const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as ApiBaseUrl;
  const vaultId = process.env.FIREBLOCKS_VAULT_ID!;

  const sdk = new FireblocksSDK(apiPrivateKey, apiKey, apiBaseUrl as string);

  console.log(`Vault ${vaultId} balance check:\n`);

  // Fireblocks-reported balances
  console.log("--- Fireblocks vault balances ---");
  try {
    const ethAsset = await sdk.getVaultAccountAsset(vaultId, "ETH_TEST5");
    console.log(`  ETH_TEST5:          balance=${ethAsset.balance}  available=${ethAsset.available}`);
  } catch {
    console.log("  ETH_TEST5:          (not activated)");
  }
  try {
    const usdcAsset = await sdk.getVaultAccountAsset(vaultId, "USDC_ETH_TEST5_0GER");
    console.log(`  USDC_ETH_TEST5_0GER: balance=${usdcAsset.balance}  available=${usdcAsset.available}`);
  } catch {
    console.log("  USDC_ETH_TEST5_0GER: (not activated)");
  }

  // On-chain balances
  console.log("\n--- On-chain balances (Sepolia) ---");
  const rpcUrl = process.env.NETWORK_HOST!;
  const provider = new JsonRpcProvider(rpcUrl);

  const address = "0xfc4C657a9209B8b2C5f4388ad5c4eCb88BCE3050";
  const ethBal = await provider.getBalance(address);
  console.log(`  ETH:  ${ethers.formatEther(ethBal)} ETH`);

  const USDC_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  const usdc = new ethers.Contract(
    USDC_SEPOLIA,
    ["function balanceOf(address) view returns (uint256)"],
    provider
  );
  const usdcBal = await usdc.balanceOf(address);
  console.log(`  USDC: ${Number(usdcBal) / 1e6} USDC`);
};

run().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
