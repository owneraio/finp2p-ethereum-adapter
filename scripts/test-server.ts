import console from 'console';
import { HardhatLogExtractor } from '../tests/utils/log-extractors';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { NetworkDetails } from '../tests/utils/models';
import { FinP2PContractConfig, FinP2PDeployerConfig } from '../finp2p-contracts/src/contracts/config';
import { ContractsManager } from '../finp2p-contracts/src/contracts/manager';
import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';
import createApp from '../src/app';
import { addressFromPrivateKey } from '../finp2p-contracts/src/contracts/utils';
import process from 'process';
import http from 'http';
import { RegulationChecker } from '../src/finp2p/regulation';
import { OssClient } from '../src/finp2p/oss.client';
import { generateAuthorizationHeader } from './utils';
import { ReuseExistingToken } from '../src/services/tokens';

const DEFAULT_HASH_TYPE = 1; // EIP712

let ethereumNodeContainer: StartedTestContainer | undefined;
let httpServer: http.Server | undefined;

const startHardhatContainer = async () => {
  console.log('Starting hardhat node container...');
  const logExtractor = new HardhatLogExtractor();
  const containerPort = 8545;
  const startedContainer = await new GenericContainer('ghcr.io/owneraio/hardhat:task-fix-docker-build')
    .withLogConsumer((stream) => logExtractor.consume(stream))
    .withExposedPorts(containerPort)
    .start();

  await logExtractor.started();
  console.log('Hardhat node started successfully.');

  let accounts = [
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  ];

  const rpcHost = startedContainer.getHost();
  const rpcPort = startedContainer.getMappedPort(containerPort).toString();
  const rpcUrl = `http://${rpcHost}:${rpcPort}`;
  ethereumNodeContainer = startedContainer;

  return { rpcUrl, accounts } as NetworkDetails;
};

const deployContract = async (config: FinP2PDeployerConfig) => {
  const contractManger = new ContractsManager({
    rpcURL: config.rpcURL,
    signerPrivateKey: config.deployerPrivateKey,
  });
  const { hashType, operatorAddress } = config;
  return contractManger.deployFinP2PContract(hashType || DEFAULT_HASH_TYPE, operatorAddress);
};

const deployERC20Contract = async (config: FinP2PDeployerConfig, finp2pTokenAddress: string) => {
  const contractManger = new ContractsManager({
    rpcURL: config.rpcURL,
    signerPrivateKey: config.deployerPrivateKey,
  });
  return contractManger.deployERC20('ERC-20', 'ERC20', finp2pTokenAddress);
};

const startApp = async (port: number, config: FinP2PContractConfig, tokenAddress: string) => {
  const finP2PContract = new FinP2PContract(config);

  const assetCreationPolicy = {
    type: 'reuse-existing-token',
    tokenAddress,
  } as ReuseExistingToken;

  const orgId = 'bank-us';
  const authTokenResolver = () => { return generateAuthorizationHeader(orgId); };
  const ossClient = new OssClient(`http://${orgId}.api.local.ownera.io/oss/query`, authTokenResolver);
  const regChecker = new RegulationChecker(ossClient);
  const app = createApp(finP2PContract, assetCreationPolicy, regChecker);
  console.log('App created successfully.');

  httpServer = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });

  return `http://localhost:${port}/api`;
};

const start = async () => {
  const port = parseInt(process.env.PORT || '3000');

  const details = await startHardhatContainer();
  const deployer = details.accounts[0];
  const operator = details.accounts[1];

  const finP2PContractAddress = await deployContract({
    rpcURL: details.rpcUrl,
    deployerPrivateKey: deployer,
    operatorAddress: addressFromPrivateKey(operator),
  });
  const tokenAddress = await deployERC20Contract({
    rpcURL: details.rpcUrl,
    deployerPrivateKey: deployer,
    operatorAddress: addressFromPrivateKey(operator),
  }, finP2PContractAddress);
  await startApp(port, {
    rpcURL: details.rpcUrl,
    signerPrivateKey: operator,
    finP2PContractAddress,
  }, tokenAddress);
};


process.on('exit', (code) => {
  console.log(`Process exiting with code: ${code}`);
  try {
    httpServer?.close();
  } catch (e) {
    console.error('Error stopping http server:', e);
  }
  try {
    ethereumNodeContainer?.stop();
  } catch (e) {
    console.error('Error stopping Ganache container:', e);
  }
});


start()
  .then(() => {
  })
  .catch(e => {
    console.error(e);
  });

