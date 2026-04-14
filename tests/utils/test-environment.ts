import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import {
  ContractsManager,
  FinP2PContract,
  addressFromPrivateKey,
} from "@owneraio/finp2p-contracts";
import { ProofProvider, workflows } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import * as console from "console";
import * as http from "http";
import NodeEnvironment from "jest-environment-node";
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { URL } from 'node:url';
import { GenericContainer, StartedTestContainer } from "testcontainers";
import winston, { format, transports } from "winston";
import createApp from "../../src/app";
import { createJsonProvider } from "../../src/config";
import { InMemoryExecDetailsStore } from "../../src/services/finp2p-contract";
import { HardhatLogExtractor } from "./log-extractors";
import { AdapterParameters, NetworkDetails, NetworkParameters } from "./models";
import { randomPort } from "./utils";

const level = "info";

const logger = winston.createLogger({
  level,
  transports: [new transports.Console({ level })],
  format: format.json(),
});

const DefaultOrgId = "some-org";

class CustomTestEnvironment extends NodeEnvironment {
  network: NetworkParameters | undefined;
  adapter: AdapterParameters | undefined;
  orgId: string;
  ethereumNodeContainer: StartedTestContainer | undefined;
  postgresSqlContainer: StartedPostgreSqlContainer | undefined;
  httpServer: http.Server | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
    this.network = this.global.network as NetworkParameters | undefined;
    this.adapter = this.global.adapter as AdapterParameters | undefined;
    this.orgId = (this.global.orgId as string) || DefaultOrgId;
  }

  async setup() {
    if (this.adapter !== undefined && this.adapter.url !== undefined) {
      console.log("Using predefined network configuration...");
      return;
    }

    try {
      let details: NetworkDetails;
      if (this.network === undefined || this.network.rpcUrl === undefined) {
        details = await this.startHardhatContainer();
      } else {
        details = this.network;
      }

      await this.startPostgresContainer();

      const deployer = details.accounts[0];
      const operator = details.accounts[1];

      const operatorAddress = addressFromPrivateKey(operator);
      const finP2PContractAddress = await this.deployContract(
        deployer,
        details.rpcUrl,
        operatorAddress
      );
      this.global.serverAddress = await this.startApp(
        operator,
        details.rpcUrl,
        finP2PContractAddress
      );
    } catch (err) {
      console.error("Error starting container:", err);
    }
  }

  async teardown() {
    try {
      if (this.postgresSqlContainer) {
        await this.dumpDatabase();
      }
      this.httpServer?.close();
      await this.ethereumNodeContainer?.stop();
      await workflows.Storage.closeAllConnections();
      await this.postgresSqlContainer?.stop();
      console.log("Ganache container stopped successfully.");
    } catch (err) {
      console.error("Error stopping Ganache container:", err);
    }
  }

  private async dumpDatabase() {
    const container = this.postgresSqlContainer!;
    const user = container.getUsername();
    const db = container.getDatabase();

    console.log("\n========== DATABASE DUMP ==========");
    console.log(`Connection: ${container.getConnectionUri()}\n`);

    // List all tables across all schemas
    const tablesResult = await container.exec([
      "psql", "-U", user, "-d", db, "-t", "-A", "-c",
      "SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');"
    ]);
    const tables = tablesResult.output.trim().split("\n").filter(t => t.length > 0);
    console.log(`Tables found: ${tables.join(", ")}\n`);

    // Dump each table
    for (const table of tables) {
      console.log(`---------- ${table} ----------`);
      const result = await container.exec([
        "psql", "-U", user, "-d", db, "--expanded", "-c",
        `SELECT * FROM ${table};`
      ]);
      console.log(result.output);
    }
    console.log("========== END DATABASE DUMP ==========\n");
  }

  private async startPostgresContainer() {
    const startedContainer = await new PostgreSqlContainer(
      "postgres:14.19"
    ).start();
    this.postgresSqlContainer = startedContainer;
  }

  private async startHardhatContainer() {
    console.log("Starting hardhat node container...");
    const logExtractor = new HardhatLogExtractor();
    const containerPort = 8545;
    const startedContainer = await new GenericContainer(
      "ghcr.io/owneraio/hardhat:task-fix-docker-build"
    )
      .withLogConsumer((stream) => logExtractor.consume(stream))
      .withExposedPorts(containerPort)
      .start();

    await logExtractor.started();
    console.log("Hardhat node started successfully.");

    let accounts = [
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    ];

    const rpcHost = startedContainer.getHost();
    const rpcPort = startedContainer.getMappedPort(containerPort).toString();
    const rpcUrl = `http://${rpcHost}:${rpcPort}`;
    this.ethereumNodeContainer = startedContainer;

    return { rpcUrl, accounts } as NetworkDetails;
  }

  private async deployContract(
    deployerPrivateKey: string,
    ethereumRPCUrl: string,
    operatorAddress: string
  ) {
    const { provider, signer } = await createJsonProvider(
      deployerPrivateKey,
      ethereumRPCUrl
    );
    const contractManger = new ContractsManager(provider, signer, logger);
    return await contractManger.deployFinP2PContract(operatorAddress);
  }

  private async startApp(
    operatorPrivateKey: string,
    ethereumRPCUrl: string,
    finP2PContractAddress: string
  ) {
    const { provider, signer } = await createJsonProvider(
      operatorPrivateKey,
      ethereumRPCUrl,
      false
    );
    const finP2PContract = new FinP2PContract(
      provider,
      signer,
      finP2PContractAddress,
      logger
    );

    const port = randomPort();

    const version = await finP2PContract.getVersion();
    console.log(`FinP2P contract version: ${version}`);

    const execDetailsStore = new InMemoryExecDetailsStore();
    const connectionString =
      this.postgresSqlContainer?.getConnectionUri() ?? "";
    const storageUser = new URL(connectionString).username
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

    const app = await createApp(
      workflowsConfig,
      logger,
      {
        type: 'finp2p-contract',
        provider,
        signer,
        finP2PClient: undefined,
        proofProvider: new ProofProvider(this.orgId, undefined, operatorPrivateKey),
        orgId: this.orgId,
        accountMappingType: 'derivation',
        accountModel: 'segregated',
        finP2PContract,
        execDetailsStore,
      },
      connectionString,
    );
    console.log("App created successfully.");

    this.httpServer = app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    // Check if migrations are done
    const readiness = await fetch(`http://localhost:${port}/health/readiness`)
    if (!readiness.ok) {
      throw new Error('Error while starting up the server')
      console.error(await readiness.text())
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
      exec("which goose", (err, stdout, stderr) => {
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

module.exports = CustomTestEnvironment;
