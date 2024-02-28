import NodeEnvironment from "jest-environment-node";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import { ethers } from "ethers";
import Finp2pERC20 from "../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json";
import { FinP2PContract } from "../../src/contracts/finp2p";
import createApp from "../../src/app";
import * as http from "http";
import * as console from "console";
import { HardhatLogExtractor } from "./log-extractors";

class CustomTestEnvironment extends NodeEnvironment {

  ethereumNodeContainer: StartedTestContainer | undefined;
  httpServer: http.Server | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
  }

  async setup() {
    try {
      const logExtractor = new HardhatLogExtractor();

      console.log("Building hardhat node docker image...")
      const container = await GenericContainer
        .fromDockerfile("./", "Dockerfile-hardhat")
        .build()

      console.log("Starting hardhat node container...")
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
      const operator = privateKeys[1];
      console.log("Hardhat node started successfully.");
      const rpcHost = this.ethereumNodeContainer.getHost();
      const rpcPort = this.ethereumNodeContainer.getMappedPort(8545).toString();
      const rpcUrl = `http://${rpcHost}:${rpcPort}`;
      const contractAddress = await this.deployFinP2PContract(rpcUrl, operator);

      const finP2PContract = new FinP2PContract(rpcUrl, operator, contractAddress);

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

  async deployFinP2PContract(rpcURL: string, privateKey: string) {
    console.log("Deploying FinP2P contract...");
    const provider = new ethers.JsonRpcProvider(rpcURL);
    const wallet = new ethers.Wallet(privateKey, provider);
    const factory = new ethers.ContractFactory(Finp2pERC20.abi, Finp2pERC20.bytecode, wallet);
    const contract = await factory.deploy();
    const address = contract.getAddress();
    console.log("FinP2P contract deployed successfully at:", address);

    return address;
  }


}

module.exports = CustomTestEnvironment;