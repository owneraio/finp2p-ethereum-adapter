import NodeEnvironment from "jest-environment-node";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import {  Wallet } from "ethers";
import { FinP2PContract } from "../../src/contracts/finp2p";
import createApp from "../../src/app";
import * as http from "http";
import * as console from "console";
import { HardhatLogExtractor } from "./log-extractors";
import { ContractsManager } from "../../src/contracts/manager";

const PREDEFINED_ACCOUNTS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
];

// const PARSE_ACCOUNTS = true;
// const NUMBER_OF_ACCOUNTS = 18;

const PARSE_ACCOUNTS = false;
const NUMBER_OF_ACCOUNTS = 2;

class CustomTestEnvironment extends NodeEnvironment {

  ethereumNodeContainer: StartedTestContainer | undefined;
  httpServer: http.Server | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
  }

  async setup() {
    try {

      const logExtractor = new HardhatLogExtractor(PARSE_ACCOUNTS, NUMBER_OF_ACCOUNTS);

      console.log("Building hardhat node docker image...");
      const container = await GenericContainer
        .fromDockerfile("./", "Dockerfile-hardhat")
        .build();

      console.log("Starting hardhat node container...");
      this.ethereumNodeContainer = await container
        .withLogConsumer((stream) => logExtractor.consume(stream))
        .withExposedPorts(8545)
        .start();

      await logExtractor.started();

      let privateKeys: string[]
      if (PARSE_ACCOUNTS) {
        privateKeys = logExtractor.privateKeys;
        if (privateKeys.length === 0) {
          console.log("No private keys found");
          return;
        }
      } else {
        privateKeys = PREDEFINED_ACCOUNTS
      }

      const deployer = privateKeys[0];
      const signer = privateKeys[1];
      console.log("Hardhat node started successfully.");
      const rpcHost = this.ethereumNodeContainer.getHost();
      const rpcPort = this.ethereumNodeContainer.getMappedPort(8545).toString();
      const rpcUrl = `http://${rpcHost}:${rpcPort}`;

      const contractManger = new ContractsManager(rpcUrl, deployer);
      const contractAddress = await contractManger.deployFinP2PContract();

      const singerAddress = new Wallet(signer).address;
      await contractManger.grantAssetManagerRole(contractAddress, singerAddress);
      await contractManger.grantTransactionManagerRole(contractAddress, singerAddress);

      const finP2PContract = new FinP2PContract(rpcUrl, signer, contractAddress);

      const port = 3001;
      const app = createApp(finP2PContract);
      console.log("App created successfully.");

      this.httpServer = app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
      });

      this.global.appPort = port;

    } catch (err) {
      console.error("Error starting Ganache container:", err);
    }
  }

  async teardown() {
    try {
      this.httpServer?.close();
      await this.ethereumNodeContainer?.stop();
      console.log("Ganache container stopped successfully.");
    } catch (err) {
      console.error("Error stopping Ganache container:", err);
    }
  }


}

module.exports = CustomTestEnvironment;