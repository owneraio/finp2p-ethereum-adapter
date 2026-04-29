import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import { ApiBaseUrl, ChainId } from "@fireblocks/fireblocks-web3-provider";
import { workflows } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import * as console from "console";
import * as dotenv from "dotenv";
import * as fs from "fs";
import NodeEnvironment from "jest-environment-node";
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { FireblocksSDK } from "fireblocks-sdk";

dotenv.config({ path: resolve(process.cwd(), ".env.fireblocks") });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required env ${name} not set`);
  return v;
}

const OPERATOR_VAULT_ID_DEFAULT = "85";
const OMNIBUS_VAULT_ID_DEFAULT = "17";
const DONOR_VAULT_ID_DEFAULT = "25";
const USDC_CONTRACT_DEFAULT = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

class FireblocksOmnibusTestEnvironment extends NodeEnvironment {

  private postgresSqlContainer: StartedPostgreSqlContainer | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
  }

  async setup() {
    console.log("[fbtest] Setting up Fireblocks omnibus test environment...");

    const apiKey = requireEnv("FIREBLOCKS_API_KEY");
    const chainId = Number(requireEnv("FIREBLOCKS_CHAIN_ID")) as ChainId;
    const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as ApiBaseUrl;

    let apiPrivateKey: string;
    if (process.env.FIREBLOCKS_API_PRIVATE_KEY) {
      apiPrivateKey = Buffer.from(process.env.FIREBLOCKS_API_PRIVATE_KEY, "base64").toString("utf-8");
    } else {
      apiPrivateKey = fs.readFileSync(requireEnv("FIREBLOCKS_API_PRIVATE_KEY_PATH"), "utf-8");
    }

    const operatorVaultId = process.env.FIREBLOCKS_VAULT_ID || OPERATOR_VAULT_ID_DEFAULT;
    const omnibusVaultId = process.env.FIREBLOCKS_OMNIBUS_VAULT_ID || OMNIBUS_VAULT_ID_DEFAULT;
    const donorVaultId = process.env.FIREBLOCKS_DONOR_VAULT_ID || DONOR_VAULT_ID_DEFAULT;
    const usdcContractAddress = (process.env.USDC_CONTRACT_ADDRESS || USDC_CONTRACT_DEFAULT).toLowerCase();

    const fireblocksSdk = new FireblocksSDK(apiPrivateKey, apiKey, apiBaseUrl as string);

    console.log("[fbtest] Looking up USDC Fireblocks asset id by contract address ...");
    const usdcAssetId = await this.findFireblocksAssetIdByContract(fireblocksSdk, donorVaultId, usdcContractAddress);
    console.log(`[fbtest] USDC asset id: ${usdcAssetId} (contract ${usdcContractAddress})`);

    const omnibusAddresses = await fireblocksSdk.getDepositAddresses(omnibusVaultId, usdcAssetId);
    if (omnibusAddresses.length === 0) {
      throw new Error(`Omnibus vault ${omnibusVaultId} has no deposit address for ${usdcAssetId}`);
    }
    const omnibusAddress = omnibusAddresses[0].address;
    console.log(`[fbtest] Omnibus address: ${omnibusAddress}`);

    const donorAddresses = await fireblocksSdk.getDepositAddresses(donorVaultId, usdcAssetId);
    if (donorAddresses.length === 0) {
      throw new Error(`Donor vault ${donorVaultId} has no deposit address for ${usdcAssetId}`);
    }
    const donorAddress = donorAddresses[0].address;
    console.log(`[fbtest] Donor address: ${donorAddress}`);

    console.log("[fbtest] Starting Postgres container...");
    this.postgresSqlContainer = await new PostgreSqlContainer("postgres:14.19").start();
    const connectionString = this.postgresSqlContainer.getConnectionUri();
    console.log("[fbtest] Postgres ready");

    this.global.fireblocksConfig = {
      apiKey,
      apiPrivateKey,
      apiBaseUrl,
      chainId,
      operatorVaultId,
      omnibusVaultId,
      donorVaultId,
      usdcAssetId,
      usdcContractAddress,
      omnibusAddress,
      donorAddress,
    };
    this.global.connectionString = connectionString;
    this.global.gooseExecutablePath = await this.whichGoose();
  }

  async teardown() {
    try {
      await workflows.Storage.closeAllConnections();
      await this.postgresSqlContainer?.stop();
      console.log("[fbtest] Test environment torn down");
    } catch (err) {
      console.error("[fbtest] Teardown error:", err);
    }
  }

  private async findFireblocksAssetIdByContract(sdk: FireblocksSDK, vaultId: string, contractAddress: string): Promise<string> {
    const lower = contractAddress.toLowerCase();
    const vault = await sdk.getVaultAccountById(vaultId);
    const assets = vault.assets ?? [];
    for (const a of assets) {
      try {
        const info = await sdk.getAssetById(a.id);
        const onchain = (info as any).onchain?.address?.toLowerCase();
        if (onchain && onchain === lower) return a.id;
      } catch {
        // skip non-EVM / unsupported lookups
      }
    }
    throw new Error(
      `No Fireblocks asset on vault ${vaultId} matches contract ${contractAddress}. ` +
      `Enable USDC on the donor vault, or set USDC_CONTRACT_ADDRESS to the right token.`
    );
  }

  private async whichGoose(): Promise<string> {
    return new Promise<string>((resolveBin, reject) => {
      const localGoose = join(process.cwd(), "bin", "goose");
      if (existsSync(localGoose)) return resolveBin(localGoose);
      exec("which goose", (err, stdout) => {
        if (err) return reject(err);
        const path = stdout.trim();
        if (!path) return reject(new Error("which goose returned empty"));
        resolveBin(path);
      });
    });
  }
}

module.exports = FireblocksOmnibusTestEnvironment;
