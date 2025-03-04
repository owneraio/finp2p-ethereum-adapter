import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import {
  ContractManagerConfig, createLocalProviderFromConfig,
  readConfig,
  writeConfig
} from "../src/contracts/config";
import console from "console";
import winston, { format, transports } from "winston";


const logger = winston.createLogger({
  level: 'info',
  transports: [new transports.Console()],
  format: format.json(),
});


type FinP2PDeployerConfig = ContractManagerConfig & {
  operatorAddress: string
  finP2PContractAddress: string | undefined
  paymentAssetCode: string | undefined
};

const configFromEnv = (): FinP2PDeployerConfig => {
  const rpcURL = process.env.RPC_URL;
  if (!rpcURL) {
    throw new Error("RPC_URL is not set");
  }
  const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY;
  if (!signerPrivateKey) {
    throw new Error("SIGNER_PRIVATE_KEY is not set");
  }
  const operatorAddress = process.env.OPERATOR_ADDRESS;
  if (!operatorAddress) {
    throw new Error("OPERATOR_ADDRESS is not set");
  }
  const finP2PContractAddress = undefined; // will be available after deployment
  const paymentAssetCode = process.env.PAYMENT_ASSET_CODE;
  return { rpcURL, signerPrivateKey, operatorAddress, finP2PContractAddress, paymentAssetCode };
}

const isAlreadyDeployed = async (config: FinP2PDeployerConfig): Promise<FinP2PDeployerConfig> => {
  const { finP2PContractAddress } = config;
  if (finP2PContractAddress) {
    logger.info(`Checking if contract ${finP2PContractAddress} is already deployed...`)

    const { provider, signer } = await createLocalProviderFromConfig(config);
    const contractManger = new ContractsManager(provider, signer, logger);
    if (await contractManger.isFinP2PContractHealthy(finP2PContractAddress)) {
      logger.info('Contract already deployed, skipping migration');
      throw new Error('Contract already deployed');
    } else {
      logger.info('Contract is not healthy, deploying a new one')
    }
  } else {
    logger.info('Contract not deployed yet, deploying a new one');
  }
  return config;
};

const deploy = async (config: FinP2PDeployerConfig): Promise<FinP2PDeployerConfig> => {
  const { operatorAddress, paymentAssetCode } = config;
  const { provider, signer } = await createLocalProviderFromConfig(config);
  const contractManger = new ContractsManager(provider, signer, logger);

  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode);
  logger.info("Contract deployed successfully. FINP2P_CONTRACT_ADDRESS=", finP2PContractAddress);
  return { ...config, finP2PContractAddress };
};

const configFile = process.env.CONFIG_FILE;
if (!configFile) {
  logger.error("Please provide the config file path using the CONFIG_FILE environment variable");
  process.exit(1);
}

logger.info(`Reading config from ${configFile}...`)

readConfig<FinP2PDeployerConfig>(configFile)
  .catch(e => {
    logger.error(`Config file ${configFile} wasn't found:`, e)
    return configFromEnv()
  })
  .then((config) => isAlreadyDeployed(config))
  .then((config) => deploy(config))
  .catch(e => {
    if (`${e}`.includes('Contract already deployed')) {
      process.exit(1)
    } else {
      logger.error("Error deploying contract:", e)
      process.exit(1)
    }
  })
  .then((config) => {
    logger.info(`Writing config to ${configFile}...`)
    logger.info(JSON.stringify(config))
    return writeConfig(config, configFile)
  });
