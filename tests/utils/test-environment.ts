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

class CustomTestEnvironment extends NodeEnvironment {

  ethereumNodeContainer: StartedTestContainer | undefined;
  httpServer: http.Server | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
  }

  async setup() {
    try {
      const logExtractor = new HardhatLogExtractor();

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
      const privateKeys = logExtractor.privateKeys;
      if (privateKeys.length === 0) {
        console.log("No private keys found");
        return;
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