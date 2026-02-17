import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import { ChainId, ApiBaseUrl } from "@fireblocks/fireblocks-web3-provider";
import {
  ContractsManager,
  FinP2PContract,
} from "@owneraio/finp2p-contracts";
import { workflows } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import * as console from "console";
import * as fs from "fs";
import * as http from "http";
import NodeEnvironment from "jest-environment-node";
import { exec } from "node:child_process";
import { URL } from "node:url";
import { Provider, Signer } from "ethers";
import winston, { format, transports } from "winston";
import createApp from "../../src/app";
import { createFireblocksEthersProvider } from "../../src/config";
import { InMemoryExecDetailsStore } from "../../src/services";
import { randomPort } from "./utils";

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
  postgresSqlContainer: StartedPostgreSqlContainer | undefined;
  httpServer: http.Server | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
    this.orgId = (this.global.orgId as string) || DefaultOrgId;
  }

  async setup() {
    console.log("Setting up Fireblocks testnet test environment...");

    const apiKey = requireEnv("FIREBLOCKS_API_KEY");
    const apiPrivateKeyPath = requireEnv("FIREBLOCKS_API_PRIVATE_KEY_PATH");
    const chainId = Number(requireEnv("FIREBLOCKS_CHAIN_ID")) as ChainId;
    const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as ApiBaseUrl;
    const vaultId = requireEnv("FIREBLOCKS_VAULT_ID");

    const apiPrivateKey = fs.readFileSync(apiPrivateKeyPath, "utf-8");

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

    await this.startPostgresContainer();

    const finP2PContractAddress = await this.deployContract(provider, signer, vaultAddress);

    this.global.serverAddress = await this.startApp(
      provider,
      signer,
      finP2PContractAddress
    );
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

  private async deployContract(
    provider: Provider,
    signer: Signer,
    operatorAddress: string
  ) {
    console.log("Deploying FinP2P contract via Fireblocks signer...");
    const contractsManager = new ContractsManager(provider, signer, logger);
    const address = await contractsManager.deployFinP2PContract(operatorAddress);
    console.log(`FinP2P contract deployed at: ${address}`);
    return address;
  }

  private async startApp(
    provider: Provider,
    signer: Signer,
    finP2PContractAddress: string
  ) {
    const finP2PContract = new FinP2PContract(
      provider,
      signer,
      finP2PContractAddress,
      logger
    );

    const port = randomPort();

    const version = await finP2PContract.getVersion();
    console.log(`FinP2P contract version: ${version}`);

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

    const app = createApp(workflowsConfig, logger, {
      type: "local",
      orgId: this.orgId,
      finP2PClient: undefined,
      finP2PContract,
      execDetailsStore: new InMemoryExecDetailsStore(),
      provider,
      signer,
      proofProvider: undefined,
    });
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
