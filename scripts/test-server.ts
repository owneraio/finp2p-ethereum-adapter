import console from "console";
import process from "process";
import http from "http";
import { Provider, Signer } from "ethers";
import winston, { format, transports } from "winston";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { HardhatLogExtractor } from "../tests/utils/log-extractors";
import { NetworkDetails } from "../tests/utils/models";
import { FinP2PContract, ContractsManager, addressFromPrivateKey, createProviderAndSigner, ProviderType  } from "@owneraio/finp2p-contracts";
import createApp from "../src/app";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { AssetCreationPolicy, ExecDetailsStore, InMemoryExecDetailsStore } from "../src/services";

let ethereumNodeContainer: StartedTestContainer | undefined;
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
  )
});

const startHardhatContainer = async () => {
  logger.info("Starting hardhat node container...");
  const logExtractor = new HardhatLogExtractor();
  const containerPort = 8545;
  const startedContainer = await new GenericContainer("ghcr.io/owneraio/hardhat:master")
    .withLogConsumer((stream) => logExtractor.consume(stream))
    .withExposedPorts(containerPort)
    .start();

  await logExtractor.started();
  logger.info("Hardhat node started successfully.");

  let accounts = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  ];

  const rpcHost = startedContainer.getHost();
  const rpcPort = startedContainer.getMappedPort(containerPort).toString();
  const rpcUrl = `http://${rpcHost}:${rpcPort}`;
  ethereumNodeContainer = startedContainer;

  return { rpcUrl, accounts } as NetworkDetails;
};

const deployContract = async (provider: Provider, signer: Signer,
                              operatorAddress: string | undefined,
                              paymentAssetCode: string | undefined = undefined) => {
  const contractManger = new ContractsManager(provider, signer, logger);
  return contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode);
};

const deployERC20Contract = async (provider: Provider, signer: Signer, finp2pTokenAddress: string) => {
  const contractManger = new ContractsManager(provider, signer, logger);
  return contractManger.deployERC20("ERC-20", "ERC20", 0, finp2pTokenAddress);
};

const startApp = async (port: number, provider: Provider, signer: Signer,
                        finP2PContract: FinP2PContract, tokenAddress: string, finP2PClient: FinP2PClient | undefined,
                        execDetailsStore: ExecDetailsStore | undefined, defaultDecimals: number = 18,
                        logger: winston.Logger) => {

  const assetCreationPolicy = {
    type: "reuse-existing-token",
    tokenAddress
  } as AssetCreationPolicy;


  const app = createApp(finP2PContract, assetCreationPolicy, finP2PClient, execDetailsStore, defaultDecimals, logger);
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
  const { provider, signer } = await createProviderAndSigner(providerType, logger, false);
  const network = await provider.getNetwork();
  logger.info(`Connected to network: ${network.name} chainId: ${network.chainId}`);
  const finP2PContractAddress = await deployContract(provider, signer, operatorAddress);
  const tokenAddress = await deployERC20Contract(provider, signer, finP2PContractAddress);

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
  const finP2PContract = new FinP2PContract(provider, signer, finP2PContractAddress, logger);

  const defaultDecimals = parseInt(process.env.DEFAULT_DECIMALS || "18");

  await startApp(port, provider, signer, finP2PContract, tokenAddress, finP2PClient, execDetailsStore, defaultDecimals, logger);
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
});


start()
  .then(() => {
  })
  .catch(e => {
    console.error(e);
  });

