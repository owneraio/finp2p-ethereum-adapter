import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
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
import { DfnsApiClient } from "@dfns/sdk";
import { AsymmetricKeySigner } from "@dfns/sdk-keysigner";
import winston, { format, transports } from "winston";
import createApp from "../../src/app";
import {
  createDfnsEthersProvider,
  DfnsAppConfig,
} from "../../src/config";
import { randomPort } from "./utils";

dotenv.config({ path: resolve(process.cwd(), ".env.dfns") });

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
      `See .env.dfns.example for required variables.`
    );
  }
  return value;
}

class DfnsTestEnvironment extends NodeEnvironment {
  orgId: string;
  walletId: string;
  destWalletId: string | undefined;
  postgresSqlContainer: StartedPostgreSqlContainer | undefined;
  httpServer: http.Server | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
    this.orgId = (this.global.orgId as string) || DefaultOrgId;
    this.walletId = (this.global.walletId as string) || requireEnv("DFNS_WALLET_ID");
    this.destWalletId = (this.global.destWalletId as string) || process.env.DFNS_DEST_WALLET_ID;
  }

  async setup() {
    console.log("Setting up Dfns testnet test environment...");

    const baseUrl = process.env.DFNS_BASE_URL || "https://api.dfns.io";
    const orgId = requireEnv("DFNS_ORG_ID");
    const authToken = requireEnv("DFNS_AUTH_TOKEN");
    const credId = requireEnv("DFNS_CRED_ID");
    const rpcUrl = requireEnv("NETWORK_HOST");

    let privateKey: string;
    if (process.env.DFNS_PRIVATE_KEY) {
      privateKey = process.env.DFNS_PRIVATE_KEY;
    } else {
      const privateKeyPath = requireEnv("DFNS_PRIVATE_KEY_PATH");
      privateKey = fs.readFileSync(privateKeyPath, "utf-8");
    }

    const keySigner = new AsymmetricKeySigner({ credId, privateKey });
    const dfnsClient = new DfnsApiClient({ baseUrl, orgId, authToken, signer: keySigner });

    console.log("Creating Dfns provider for source wallet...");
    const { provider, signer } = await createDfnsEthersProvider({
      dfnsClient,
      walletId: this.walletId,
      rpcUrl,
    });

    const walletAddress = await signer.getAddress();
    console.log(`Dfns wallet address: ${walletAddress}`);

    const network = await provider.getNetwork();
    console.log(`Connected to chain ${network.chainId}`);

    // Get the wallet's compressed public key to derive finId
    // finId = compressed secp256k1 public key (hex, no 0x prefix)
    const walletInfo = await dfnsClient.wallets.getWallet({ walletId: this.walletId });
    const vaultFinId = walletInfo.signingKey.publicKey;
    console.log(`Wallet finId: ${vaultFinId}`);
    this.global.vaultFinId = vaultFinId;
    this.global.vaultAddress = walletAddress;

    // Use pre-configured destination wallet or create one dynamically
    let destWalletId: string;
    if (this.destWalletId) {
      destWalletId = this.destWalletId;
      console.log(`Using pre-configured destination wallet: ${destWalletId}`);
    } else {
      const destWalletName = `finp2p-test-dest-${Date.now()}`;
      console.log(`Creating destination wallet: ${destWalletName}`);
      const destWallet = await dfnsClient.wallets.createWallet({
        body: { network: "EthereumSepolia", name: destWalletName },
      });
      destWalletId = destWallet.id;
      console.log(`Destination wallet created: ${destWalletId}`);
    }

    const destWalletInfo = await dfnsClient.wallets.getWallet({ walletId: destWalletId });
    const destAddress = destWalletInfo.address!;
    console.log(`Destination wallet address: ${destAddress}`);

    const destFinId = destWalletInfo.signingKey.publicKey;
    console.log(`Destination wallet finId: ${destFinId}`);
    this.global.destFinId = destFinId;

    const appConfig: DfnsAppConfig = {
      type: "dfns",
      orgId: this.orgId,
      provider,
      signer,
      finP2PClient: undefined,
      proofProvider: undefined,
      dfnsBaseUrl: baseUrl,
      dfnsOrgId: orgId,
      dfnsAuthToken: authToken,
      dfnsCredId: credId,
      dfnsPrivateKey: privateKey,
      rpcUrl,
      assetIssuerWalletId: this.walletId,
      assetEscrowWalletId: this.walletId,
    };

    await this.startPostgresContainer();

    this.global.serverAddress = await this.startApp(appConfig);
  }

  async teardown() {
    try {
      this.httpServer?.close();
      await workflows.Storage.closeAllConnections();
      await this.postgresSqlContainer?.stop();
      console.log("Dfns test environment torn down successfully.");
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

  private async startApp(appConfig: DfnsAppConfig) {
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

module.exports = DfnsTestEnvironment;
