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
  return contractManger.deployFinP2PContract(config.operatorAddress);
};

const startApp = async (port: number, config: FinP2PContractConfig) => {
  const finP2PContract = new FinP2PContract(config);

  const { name, version, chainId, verifyingContract }  = await finP2PContract.eip712Domain();
  console.log(`EIP721 domain:\n\tdomain: ${name}\n\tversion: ${version}\n\tchainId: ${chainId}\n\tverifyingContract: ${verifyingContract}`);

  const app = createApp(finP2PContract);
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
  await startApp(port, {
    rpcURL: details.rpcUrl,
    signerPrivateKey: operator,
    finP2PContractAddress,
  });
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

