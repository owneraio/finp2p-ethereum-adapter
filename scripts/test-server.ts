import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  ContractsManager,
  FinP2PContract,
  addressFromPrivateKey,
} from "@owneraio/finp2p-contracts";
import { workflows } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import console from "console";
import { Provider, Signer } from "ethers";
import http from "http";
import { exec } from "node:child_process";
import { URL } from "node:url";
import process from "process";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import winston, { format, transports } from "winston";
import createApp from "../src/app";
import { ProviderType, createProviderAndSigner } from "../src/config";
import { ExecDetailsStore, InMemoryExecDetailsStore } from "../src/services";
import { HardhatLogExtractor } from "../tests/utils/log-extractors";
import { NetworkDetails } from "../tests/utils/models";

let ethereumNodeContainer: StartedTestContainer | undefined;
let postgresSqlContainer: StartedPostgreSqlContainer | undefined;
let httpServer: http.Server | undefined;
const providerType: ProviderType = "local";

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.combine(
    format.timestamp(),
    format(function dynamicContent(info) {
      if (info.timestamp) {
        info.time = info.timestamp;
        delete info.timestamp;
      }
      if (info.message) {
        info.msg = info.message;
        // @ts-ignore
        delete info.message;
      }
      return info;
    })(),
    format.json()
  ),
});

const whichGoose = () =>
  new Promise<string>((resolve, reject) => {
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

const startPostgresContainer = async () => {
  logger.info("Starting Postgres container...");
  const startedContainer = await new PostgreSqlContainer(
    "postgres:14.19"
  ).start();
  postgresSqlContainer = startedContainer;
  logger.info("Postgres container started successfully");
  return startedContainer.getConnectionUri();
};

const startHardhatContainer = async () => {
  logger.info("Starting hardhat node container...");
  const logExtractor = new HardhatLogExtractor();
  const containerPort = 8545;
  const startedContainer = await new GenericContainer(
    "ghcr.io/owneraio/hardhat:master"
  )
    .withLogConsumer((stream) => logExtractor.consume(stream))
    .withExposedPorts(containerPort)
    .start();

  await logExtractor.started();
  logger.info("Hardhat node started successfully.");

  let accounts = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  ];

  const rpcHost = startedContainer.getHost();
  const rpcPort = startedContainer.getMappedPort(containerPort).toString();
  const rpcUrl = `http://${rpcHost}:${rpcPort}`;
  ethereumNodeContainer = startedContainer;

  return { rpcUrl, accounts } as NetworkDetails;
};

const deployContract = async (
  provider: Provider,
  signer: Signer,
  operatorAddress: string | undefined,
  paymentAssetCode: string | undefined = undefined
) => {
  const contractManger = new ContractsManager(provider, signer, logger);
  return contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode);
};

const deployERC20Contract = async (
  provider: Provider,
  signer: Signer,
  finp2pTokenAddress: string
) => {
  const contractManger = new ContractsManager(provider, signer, logger);
  return contractManger.deployERC20ViaAssetRegistry("ERC-20", "ERC20", 0, finp2pTokenAddress);
};

const startApp = async (
  orgId: string,
  port: number,
  provider: Provider,
  signer: Signer,
  finP2PContract: FinP2PContract,
  tokenAddress: string,
  finP2PClient: FinP2PClient | undefined,
  execDetailsStore: ExecDetailsStore | undefined,
  workflowsConfig: workflows.Config | undefined,
  logger: winston.Logger
) => {
  const app = createApp(
    orgId,
    finP2PContract,
    finP2PClient,
    execDetailsStore,
    workflowsConfig,
    logger
  );
  logger.info("App created successfully.");

  httpServer = app.listen(port, () => {
    logger.info(`Server listening on port ${port}`);
  });

  return `http://localhost:${port}/api`;
};

const start = async () => {
  const port = parseInt(process.env.PORT || "3000");

  const details = await startHardhatContainer();
  const deployer = details.accounts[0];
  const operator = details.accounts[1];

  process.env.OPERATOR_PRIVATE_KEY = deployer;
  process.env.NETWORK_HOST = details.rpcUrl;

  const operatorAddress = addressFromPrivateKey(operator);
  const { provider, signer } = await createProviderAndSigner(
    providerType,
    true
  );
  const network = await provider.getNetwork();
  logger.info(
    `Connected to network: ${network.name} chainId: ${network.chainId}`
  );
  const finP2PContractAddress = await deployContract(
    provider,
    signer,
    operatorAddress
  );
  const tokenAddress = await deployERC20Contract(
    provider,
    signer,
    finP2PContractAddress
  );
  const orgId = process.env.ORGANIZATION_ID;
  if (!orgId) {
    throw new Error("ORGANIZATION_ID is not set");
  }
  const finP2PAddress = process.env.FINP2P_ADDRESS;
  if (!finP2PAddress) {
    throw new Error("FINP2P_ADDRESS is not set");
  }
  const ossUrl = process.env.OSS_URL;
  if (!ossUrl) {
    throw new Error("OSS_URL is not set");
  }
  const finP2PClient = new FinP2PClient(finP2PAddress, ossUrl);

  const execDetailsStore = new InMemoryExecDetailsStore();
  const finP2PContract = new FinP2PContract(
    provider,
    signer,
    finP2PContractAddress,
    logger
  );

  const connectionString = await startPostgresContainer();
  const workflowsConfig = {
    migration: {
      connectionString,
      gooseExecutablePath: await whichGoose(),
      migrationListTableName: "finp2p_ethereum_adapater_migrations",
      storageUser: new URL(connectionString).username,
    },
    storage: { connectionString },
    service: {}
  };

  await startApp(
    orgId,
    port,
    provider,
    signer,
    finP2PContract,
    tokenAddress,
    finP2PClient,
    execDetailsStore,
    workflowsConfig,
    logger
  );
};

process.on("exit", (code) => {
  logger.info(`Process exiting with code: ${code}`);
  try {
    httpServer?.close();
  } catch (e) {
    logger.error("Error stopping http server:", e);
  }
  try {
    ethereumNodeContainer?.stop();
  } catch (e) {
    logger.error("Error stopping Ganache container:", e);
  }
  try {
    postgresSqlContainer?.stop();
  } catch (e) {
    logger.error("Error stopping postgres container:", e);
  }
});

start()
  .then(() => {})
  .catch((e) => {
    console.error(e);
  });
