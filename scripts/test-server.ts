import console from 'console';
import { HardhatLogExtractor } from '../tests/utils/log-extractors';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { NetworkDetails } from '../tests/utils/models';
import { ContractsManager } from '../finp2p-contracts/src/contracts/manager';
import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';
import createApp from '../src/app';
import { addressFromPrivateKey } from '../finp2p-contracts/src/contracts/utils';
import process from 'process';
import http from 'http';
import { RegulationChecker } from '../src/finp2p/regulation';
import { OssClient } from '../src/finp2p/oss.client';
import { generateAuthorizationHeader } from './utils';
import { Provider, Signer } from "ethers";
import { createProviderAndSigner, ProviderType } from "../finp2p-contracts/src/contracts/config";
import { AssetCreationPolicy } from "../src/services/tokens";

let ethereumNodeContainer: StartedTestContainer | undefined;
let httpServer: http.Server | undefined;
const providerType: ProviderType = 'local';

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

const deployContract = async (provider: Provider, signer: Signer,
                              operatorAddress: string | undefined,
                              paymentAssetCode: string | undefined = undefined) => {
  const contractManger = new ContractsManager(provider, signer);
  return contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode);
};

const deployERC20Contract = async (provider: Provider, signer: Signer, finp2pTokenAddress: string) => {
  const contractManger = new ContractsManager(provider, signer);
  return contractManger.deployERC20('ERC-20', 'ERC20', 0, finp2pTokenAddress);
};

const startApp = async (port: number, provider: Provider, signer: Signer, finP2PContractAddress: string, tokenAddress: string) => {
  const finP2PContract = new FinP2PContract(provider, signer, finP2PContractAddress);

  const assetCreationPolicy = {
    type: 'reuse-existing-token',
    tokenAddress,
  } as AssetCreationPolicy;

  const orgId = 'bank-il';
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

  process.env.OPERATOR_PRIVATE_KEY = deployer;
  process.env.NETWORK_HOST = details.rpcUrl;

  const operatorAddress = addressFromPrivateKey(operator);
  const { provider, signer } = await createProviderAndSigner(providerType);
  const network = await provider.getNetwork();
  console.log(`Connected to network: ${network.name} chainId: ${network.chainId}`);
  const finP2PContractAddress = await deployContract(provider, signer, operatorAddress);
  const tokenAddress = await deployERC20Contract(provider, signer, finP2PContractAddress);
  await startApp(port, provider, signer, finP2PContractAddress, tokenAddress);
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

