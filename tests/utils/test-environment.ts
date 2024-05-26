import NodeEnvironment from "jest-environment-node";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import { FinP2PContract } from "../../finp2p-contracts/src/contracts/finp2p";
import createApp from "../../src/app";
import * as http from "http";
import * as console from "console";
import { HardhatLogExtractor } from "./log-extractors";
import { ContractsManager } from "../../finp2p-contracts/src/contracts/manager";
import { AdapterParameters, NetworkDetails, NetworkParameters } from "./models";
import { randomPort } from "./utils";
import { addressFromPrivateKey } from "../../finp2p-contracts/src/contracts/utils";
import { FinP2PDeployerConfig, FinP2PContractConfig } from "../../finp2p-contracts/src/contracts/config";


class CustomTestEnvironment extends NodeEnvironment {

  network: NetworkParameters | undefined;
  adapter: AdapterParameters | undefined;
  ethereumNodeContainer: StartedTestContainer | undefined;
  httpServer: http.Server | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
    this.network = this.global.network as NetworkParameters | undefined;
    this.adapter = this.global.adapter as AdapterParameters | undefined;
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

      const deployer = details.accounts[0];
      const operator = details.accounts[1];

      const finP2PContractAddress = await this.deployContract({
        rpcURL: details.rpcUrl,
        deployerPrivateKey: deployer,
        operatorAddress: addressFromPrivateKey(operator),
      })
      this.global.serverAddress = await this.startApp({
        rpcURL: details.rpcUrl,
        signerPrivateKey: operator,
        finP2PContractAddress
      });

    } catch (err) {
      console.error("Error starting container:", err);
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

  private async startHardhatContainer() {
    console.log("Starting hardhat node container...");
    const logExtractor = new HardhatLogExtractor();
    const containerPort = 8545;
    const startedContainer = await new GenericContainer("ghcr.io/owneraio/hardhat:task-fix-docker-build")
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

  private async deployContract(config: FinP2PDeployerConfig) {
    const contractManger = new ContractsManager({
      rpcURL: config.rpcURL,
      signerPrivateKey: config.deployerPrivateKey
    });
    return await contractManger.deployFinP2PContract(config.operatorAddress);
  }

  private async startApp(config: FinP2PContractConfig) {
    const finP2PContract = new FinP2PContract(config);

    const port = randomPort();
    const app = createApp(finP2PContract);
    console.log("App created successfully.");

    this.httpServer = app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    return `http://localhost:${port}/api`;
  }
}


module.exports = CustomTestEnvironment;