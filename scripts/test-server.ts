import console from 'console';
import { HardhatLogExtractor } from '../tests/utils/log-extractors';
import { GenericContainer } from 'testcontainers';
import { ContractsManager } from '../finp2p-contracts/src/contracts/manager';
import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';
import createApp from '../src/app';
import { addressFromPrivateKey } from '../finp2p-contracts/src/contracts/utils';
import createOperatorApp from '../src/operator';


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

  const rpcHost = startedContainer.getHost();
  const rpcPort = startedContainer.getMappedPort(containerPort).toString();
  return `http://${rpcHost}:${rpcPort}`;
};

const preCreatePaymentAsset = async (contract: FinP2PContract, finP2PContractAddress: string) => {
  const assetId = 'USD';
  const tokenAddress = await contract.deployERC20(assetId, assetId, finP2PContractAddress);

  const txHash = await contract.associateAsset(assetId, tokenAddress);
  await contract.waitForCompletion(txHash);
};

const startServer = async (port: number, operatorPort: number) => {
  const rpcURL = await startHardhatContainer();
  const deployer = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const operator = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

  const contractManger = new ContractsManager({ rpcURL, signerPrivateKey: deployer });
  const finP2PContractAddress = await contractManger.deployFinP2PContract(addressFromPrivateKey(operator));

  let contract = new FinP2PContract({ rpcURL, signerPrivateKey: operator, finP2PContractAddress });
  await preCreatePaymentAsset(contract, finP2PContractAddress);

  const opApp = createOperatorApp(contract);
  opApp.listen(operatorPort, () => {
    console.log(`Operator app is listening on port ${operatorPort}`);
  });

  const app = createApp(contract);
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
};

const port = parseInt(process.env.PORT || '3000');
const operatorPort = parseInt(process.env.OPERATOR_PORT || '3001');

startServer(port, operatorPort)
  .then(() => {
  })
  .catch(e => {
    console.error(e);
  });