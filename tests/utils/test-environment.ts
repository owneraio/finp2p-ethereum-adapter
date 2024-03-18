import NodeEnvironment from "jest-environment-node";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import { NonceManager, Wallet } from "ethers";
import { FinP2PContract } from "../../src/contracts/finp2p";
import createApp from "../../src/app";
import * as http from "http";
import * as console from "console";
import { HardhatLogExtractor } from "./log-extractors";
import { ContractsManager } from "../../src/contracts/manager";
import { AdapterParameters, NetworkDetails, NetworkParameters } from "./models";


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
    try {
      let details: NetworkDetails;
      if (this.network === undefined || this.network.rpcUrl === undefined) {
        const container = await this.buildContainer();
        details = await this.startContainer(container, this.network?.accounts || []);
      } else {
        details = this.network;
      }

      const deployer = new NonceManager(new Wallet(details.accounts[0]));
      const operator = new NonceManager(new Wallet(details.accounts[1]));

      const contractAddress = await this.deployContract(details.rpcUrl, deployer, await operator.getAddress());
      this.global.serverAddress = await this.startApp(contractAddress, details.rpcUrl, operator);

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

  private async buildContainer() {
    console.log("Building hardhat node docker image...");
    return await GenericContainer
      .fromDockerfile("./", "Dockerfile-hardhat")
      .build();
  }

  private async startContainer(container: GenericContainer, predefinedAccounts: string[]) {
    console.log("Starting hardhat node container...");
    const logExtractor = new HardhatLogExtractor();
    const containerPort = 8545;
    const startedContainer = await container
      .withLogConsumer((stream) => logExtractor.consume(stream))
      .withExposedPorts(containerPort)
      .start();

    await logExtractor.started();
    console.log("Hardhat node started successfully.");

    let accounts: string[];
    if (predefinedAccounts.length > 0) {
      accounts = predefinedAccounts;
    } else {
      accounts = logExtractor.privateKeys;
    }

    if (accounts.length === 0) {
      throw new Error("No private keys found");
    }

    const rpcHost = startedContainer.getHost();
    const rpcPort = startedContainer.getMappedPort(containerPort).toString();
    const rpcUrl = `http://${rpcHost}:${rpcPort}`;
    this.ethereumNodeContainer = startedContainer;

    return { rpcUrl, accounts } as NetworkDetails;
  }

  private async deployContract(rpcUrl: string, deployer: NonceManager, signerAddress: string | null) {
    const contractManger = new ContractsManager(rpcUrl, deployer);
    return await contractManger.deployFinP2PContract(signerAddress);
  }

  private async startApp(contractAddress: string, rpcUrl: string, signer: NonceManager) {
    const finP2PContract = new FinP2PContract(rpcUrl, signer, contractAddress);

    const port = this.adapter?.port || 3001;
    const app = createApp(finP2PContract);
    console.log("App created successfully.");

    this.httpServer = app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    return this.httpServer.address();
  }
}


module.exports = CustomTestEnvironment;