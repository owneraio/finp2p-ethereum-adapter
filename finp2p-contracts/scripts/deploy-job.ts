import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import { FinP2PDeployerConfig, FinP2PContractConfig, readConfig, writeConfig } from "../src/contracts/config";
import console from "console";

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
  .then((config) => isAlreadyDeployed(config))
  .then((config) => deploy(config))
  .then((config) => writeConfig(config, configFile));
