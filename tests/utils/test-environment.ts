import {
  ContractsManager,
  FinP2PContract,
  addressFromPrivateKey,
} from "@owneraio/finp2p-contracts";
import { workflows } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PreparedAppHttpServer, SkeletonTestEnvironment } from '@owneraio/skeleton-test-environment';
import * as console from "console";
import * as http from "http";
import { setTimeout as wait } from 'node:timers/promises';
import { GenericContainer, StartedTestContainer } from "testcontainers";
import winston, { format, transports } from "winston";
import createApp from "../../src/app";
import { createJsonProvider } from "../../src/config";
import { InMemoryExecDetailsStore } from "../../src/services";
import { HardhatLogExtractor } from "./log-extractors";
import { NetworkDetails } from "./models";

const level = "info";
const logger = winston.createLogger({
  level,
  transports: [new transports.Console({ level })],
  format: format.json(),
});

interface EthereumConfig {
  ethereumNodeContainer: StartedTestContainer;
  ethereumNetworkDetails: NetworkDetails;
}

interface Containers {
  httpServer: http.Server;
  ethConfig: EthereumConfig;
}

class CustomTestEnvironment extends SkeletonTestEnvironment<Containers> {
  async startAppHttpServer(generatedPort: number): Promise<PreparedAppHttpServer<Containers>> {
    const ethConfig = await this.startHardhatContainer()
    const deployer = ethConfig.ethereumNetworkDetails.accounts[0]
    const operator = ethConfig.ethereumNetworkDetails.accounts[1]
    const operatorAddress = addressFromPrivateKey(operator);
    const finP2PContractAddress = await this.deployContract(
      deployer,
      ethConfig.ethereumNetworkDetails.rpcUrl,
      operatorAddress
    );

    const { provider, signer } = await createJsonProvider(
      operator,
      ethConfig.ethereumNetworkDetails.rpcUrl,
      false
    );

    const finP2PContract = new FinP2PContract(
      provider,
      signer,
      finP2PContractAddress,
      logger
    );

    const version = await finP2PContract.getVersion();
    console.log(`FinP2P contract version: ${version}`);

    const execDetailsStore = new InMemoryExecDetailsStore();
    const postgresContainer = await this.startPostgresContainer()
    const app = createApp("some-org", finP2PContract, undefined, execDetailsStore, {
      migration: {
        ...postgresContainer,
        gooseExecutablePath: await this.getGooseExecutablePath(),
        migrationListTableName: "finp2p_ethereum_adapter_migrations"
      },
      storage: {
        ...postgresContainer
      }
    }, logger)

    await this.checkHealthReadiness(generatedPort)

    return {
      httpAddress: `http://localhost:${generatedPort}/api`,
      userData: {
        httpServer: app.listen(generatedPort),
        ethConfig
      }
    }
  }

  async stopAppHttpServer(preparedApp: PreparedAppHttpServer<Containers>): Promise<void> {
    await preparedApp.userData.ethConfig.ethereumNodeContainer.stop()
    await preparedApp.userData.httpServer.close()
    await workflows.Storage.closeAllConnections()
  }

  private async deployContract(
    deployerPrivateKey: string,
    ethereumRPCUrl: string,
    operatorAddress: string
  ): Promise<string> {
    const { provider, signer } = await createJsonProvider(
      deployerPrivateKey,
      ethereumRPCUrl
    );
    const contractManger = new ContractsManager(provider, signer, logger);
    return await contractManger.deployFinP2PContract(operatorAddress);
  }

  private async startHardhatContainer(): Promise<EthereumConfig> {
    console.log("Starting hardhat node container...");
    const logExtractor = new HardhatLogExtractor();
    const randomPort = await this.generateRandomPort()
    const ethereumNodeContainer = await new GenericContainer(
      "ghcr.io/owneraio/hardhat:task-fix-docker-build"
    )
    .withLogConsumer((stream) => logExtractor.consume(stream))
    .withExposedPorts({
      container: 8545,
      host: randomPort
    })
    .start();

    await logExtractor.started();
    console.log("Hardhat node started successfully.");

    let accounts = [
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    ];

    const rpcHost = ethereumNodeContainer.getHost();
    const rpcUrl = `http://${rpcHost}:${randomPort}`;
    return {
      ethereumNodeContainer,
      ethereumNetworkDetails: {
        accounts,
        rpcUrl
      }
    }
  }

  private async checkHealthReadiness(generatedPort: number): Promise<void> {
    for (let i = 0; i < 30; i++) {
      try {
        const readiness = await fetch(`http://localhost:${generatedPort}/health/readiness`)
        if (readiness.ok) {
          break
        } else {
          throw new Error('should wait')
        }
      } catch {
        await wait(300)
      }
    }
  }
}

module.exports = CustomTestEnvironment;
