import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import { ChainId, ApiBaseUrl } from "@fireblocks/fireblocks-web3-provider";
import { workflows } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import * as console from "console";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as http from "http";
import NodeEnvironment from "jest-environment-node";
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { URL } from "node:url";
import { FireblocksSDK } from "fireblocks-sdk";
import winston, { format, transports } from "winston";
import createApp from "../../src/app";
import {
  createFireblocksEthersProvider,
  FireblocksAppConfig,
} from "../../src/config";
import { randomPort } from "./utils";

dotenv.config({ path: resolve(process.cwd(), ".env.fireblocks") });

const level = "info";

const logger = winston.createLogger({
  level,
  transports: [new transports.Console({ level })],
  format: format.json(),
});

const DefaultOrgId = "some-org";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Required environment variable ${name} is not set. ` +
      `See .env.fireblocks.example for required variables.`
    );
  }
  return value;
}

class FireblocksTestEnvironment extends NodeEnvironment {
  orgId: string;
  vaultAccountId: string;
  destVaultAccountId: string | undefined;
  postgresSqlContainer: StartedPostgreSqlContainer | undefined;
  httpServer: http.Server | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
    this.orgId = (this.global.orgId as string) || DefaultOrgId;
    this.vaultAccountId = (this.global.vaultAccountId as string) || requireEnv("FIREBLOCKS_VAULT_ID");
    this.destVaultAccountId = this.global.destVaultAccountId as string | undefined;
  }

  async setup() {
    console.log("Setting up Fireblocks testnet test environment...");

    const apiKey = requireEnv("FIREBLOCKS_API_KEY");
    const chainId = Number(requireEnv("FIREBLOCKS_CHAIN_ID")) as ChainId;
    const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as ApiBaseUrl;
    const vaultId = this.vaultAccountId;

    let apiPrivateKey: string;
    if (process.env.FIREBLOCKS_API_PRIVATE_KEY) {
      apiPrivateKey = Buffer.from(process.env.FIREBLOCKS_API_PRIVATE_KEY, "base64").toString("utf-8");
    } else {
      const apiPrivateKeyPath = requireEnv("FIREBLOCKS_API_PRIVATE_KEY_PATH");
      apiPrivateKey = fs.readFileSync(apiPrivateKeyPath, "utf-8");
    }

    console.log("Creating Fireblocks provider...");
    const { provider, signer } = await createFireblocksEthersProvider({
      apiKey,
      privateKey: apiPrivateKey,
      chainId,
      apiBaseUrl,
      vaultAccountIds: [vaultId],
    });

    const vaultAddress = await signer.getAddress();
    console.log(`Fireblocks vault address: ${vaultAddress}`);

    const network = await provider.getNetwork();
    console.log(`Connected to chain ${network.chainId}`);

    const fireblocksSdk = new FireblocksSDK(apiPrivateKey, apiKey, apiBaseUrl as string);

    // Get the vault's compressed public key to derive finId
    // finId = compressed secp256k1 public key (hex, no 0x prefix)
    const vaultPubKeyInfo = await fireblocksSdk.getPublicKeyInfoForVaultAccount({
      vaultAccountId: Number(vaultId),
      assetId: "ETH_TEST5",
      change: 0,
      addressIndex: 0,
      compressed: true,
    });
    const vaultFinId = vaultPubKeyInfo.publicKey.replace(/^0x/, "");
    console.log(`Vault finId: ${vaultFinId}`);
    this.global.vaultFinId = vaultFinId;
    this.global.vaultAddress = vaultAddress;

    // Use pre-configured destination vault or create one dynamically
    let destVaultId: string;
    if (this.destVaultAccountId) {
      destVaultId = this.destVaultAccountId;
      console.log(`Using pre-configured destination vault: ${destVaultId}`);
    } else {
      const destVaultName = `finp2p-test-dest-${Date.now()}`;
      console.log(`Creating destination vault: ${destVaultName}`);
      const destVault = await fireblocksSdk.createVaultAccount(destVaultName);
      destVaultId = destVault.id;
      console.log(`Destination vault created: ${destVaultId}`);
      await fireblocksSdk.createVaultAsset(destVaultId, "ETH_TEST5");
    }

    const destDepositAddresses = await fireblocksSdk.getDepositAddresses(destVaultId, "ETH_TEST5");
    const destAddress = destDepositAddresses[0].address;
    console.log(`Destination vault address: ${destAddress}`);

    const destPubKeyInfo = await fireblocksSdk.getPublicKeyInfoForVaultAccount({
      vaultAccountId: Number(destVaultId),
      assetId: "ETH_TEST5",
      change: 0,
      addressIndex: 0,
      compressed: true,
    });
    const destFinId = destPubKeyInfo.publicKey.replace(/^0x/, "");
    console.log(`Destination vault finId: ${destFinId}`);
    this.global.destFinId = destFinId;

    const appConfig: FireblocksAppConfig = {
      type: "fireblocks",
      orgId: this.orgId,
      provider,
      signer,
      finP2PClient: undefined,
      proofProvider: undefined,
      apiKey,
      apiPrivateKey,
      chainId,
      apiBaseUrl,
      assetIssuerVaultId: vaultId,
      assetEscrowVaultId: vaultId,
    };

    await this.startPostgresContainer();

    this.global.serverAddress = await this.startApp(appConfig);
  }

  async teardown() {
    try {
      this.httpServer?.close();
      await workflows.Storage.closeAllConnections();
      await this.postgresSqlContainer?.stop();
      console.log("Fireblocks test environment torn down successfully.");
    } catch (err) {
      console.error("Error during teardown:", err);
    }
  }

  private async startPostgresContainer() {
    console.log("Starting PostgreSQL container...");
    this.postgresSqlContainer = await new PostgreSqlContainer(
      "postgres:14.19"
    ).start();
    console.log("PostgreSQL container started.");
  }

  private async startApp(appConfig: FireblocksAppConfig) {
    const port = randomPort();

    const connectionString =
      this.postgresSqlContainer?.getConnectionUri() ?? "";
    const storageUser = new URL(connectionString).username;

    const workflowsConfig = {
      migration: {
        connectionString,
        gooseExecutablePath: await this.whichGoose(),
        migrationListTableName: "finp2p_ethereum_adapter_migrations",
        storageUser,
      },
      storage: { connectionString },
      service: {},
    };

    const app = await createApp(workflowsConfig, logger, appConfig);
    console.log("App created successfully.");

    this.httpServer = app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    const readiness = await fetch(`http://localhost:${port}/health/readiness`);
    if (!readiness.ok) {
      console.error(await readiness.text());
      throw new Error("Error while starting up the server");
    }

    return `http://localhost:${port}/api`;
  }

  private async whichGoose() {
    return new Promise<string>((resolve, reject) => {
      const localGoose = join(process.cwd(), "bin", "goose");
      if (existsSync(localGoose)) {
        resolve(localGoose);
        return;
      }
      exec("which goose", (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }

        const path = stdout.trim();
        if (path.length === 0) {
          reject(new Error("which goose returned an empty path"));
          return;
        }

        resolve(path);
      });
    });
  }
}

module.exports = FireblocksTestEnvironment;
