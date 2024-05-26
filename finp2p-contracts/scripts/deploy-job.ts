import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import { FinP2PDeployerConfig, readConfig, writeConfig } from "../src/contracts/config";
import console from "console";

const configFromEnv = (): FinP2PDeployerConfig => {
  const rpcURL = process.env.RPC_URL;
  if (!rpcURL) {
    throw new Error("RPC_URL is not set");
  }
  const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY;
  if (!signerPrivateKey) {
    throw new Error("SIGNER_PRIVATE_KEY is not set");
  }
  const operatorAddress = process.env.OPERATOR_ADDRESS;
  if (!operatorAddress) {
    throw new Error("OPERATOR_ADDRESS is not set");
  }
  return {
    rpcURL, deployerPrivateKey, signerPrivateKey, operatorAddress
  } as FinP2PDeployerConfig
}

const isAlreadyDeployed = async (config: FinP2PDeployerConfig & {
  finP2PContractAddress?: string
}): Promise<FinP2PDeployerConfig> => {
  const {
    rpcURL, deployerPrivateKey, signerPrivateKey,
    operatorAddress, finP2PContractAddress
  } = config;
  if (finP2PContractAddress) {
    const contractManger = new ContractsManager({ rpcURL, signerPrivateKey: deployerPrivateKey });
    if (await contractManger.isFinP2PContractHealthy(finP2PContractAddress)) {
      console.log("Contract already deployed, skipping migration");
      process.exit(0);
    }
  }

  return { rpcURL, deployerPrivateKey, signerPrivateKey, operatorAddress };
};

const deploy = async (config: FinP2PDeployerConfig): Promise<FinP2PDeployerConfig & {
  finP2PContractAddress: string
}> => {
  const { rpcURL, signerPrivateKey, deployerPrivateKey, operatorAddress } = config;
  const contractManger = new ContractsManager({ rpcURL, signerPrivateKey: deployerPrivateKey });
  const finP2PContractAddress = await contractManger.deployFinP2PContract(config.operatorAddress);
  console.log("Contract deployed successfully. FINP2P_CONTRACT_ADDRESS=", finP2PContractAddress);
  return { rpcURL, deployerPrivateKey, signerPrivateKey, operatorAddress, finP2PContractAddress };
};

const configFile = process.env.CONFIG_FILE;
if (!configFile) {
  console.error("Please provide the config file path using the CONFIG_FILE environment variable");
  process.exit(1);
}

readConfig<FinP2PDeployerConfig>(configFile)
  .catch(_ => configFromEnv())
  .then((config) => isAlreadyDeployed(config))
  .then((config) => deploy(config))
  .then((config) => writeConfig(config, configFile));
