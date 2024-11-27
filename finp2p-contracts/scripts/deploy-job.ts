import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import { FinP2PContractConfig, FinP2PDeployerConfig, readConfig, writeConfig } from "../src/contracts/config";
import console from "console";
import fs from "node:fs";
import { ApiBaseUrl, ChainId } from "@fireblocks/fireblocks-web3-provider";

const configFromEnv = (): FinP2PDeployerConfig => {
  const fbPrivateKeyPath = process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH || "";
  if (!fbPrivateKeyPath) {
    throw new Error("FIREBLOCKS_API_PRIVATE_KEY_PATH is not set");
  }
  const privateKey = fs.readFileSync(fbPrivateKeyPath, "utf-8");
  const apiKey = process.env.FIREBLOCKS_API_KEY || "";
  if (!apiKey) {
    throw new Error("FIREBLOCKS_API_KEY is not set");
  }
  const chainId = (process.env.FIREBLOCKS_CHAIN_ID || ChainId.MAINNET) as ChainId;
  const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as ApiBaseUrl
  const vaultAccountIds = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS?.split(',').map((id) => parseInt(id)) || [];
  const operatorAddress = process.env.OPERATOR_ADDRESS;
  if (!operatorAddress) {
    throw new Error("OPERATOR_ADDRESS is not set");
  }
  const paymentAssetCode = process.env.PAYMENT_ASSET_CODE;

  return {
    privateKey, apiKey, chainId, apiBaseUrl, vaultAccountIds, operatorAddress, paymentAssetCode
  } as FinP2PDeployerConfig
}

const isAlreadyDeployed = async (config: FinP2PDeployerConfig & {
  finP2PContractAddress?: string
}): Promise<FinP2PDeployerConfig> => {
  const {
    finP2PContractAddress, paymentAssetCode
  } = config;
  if (finP2PContractAddress) {
    console.log(`Checking if contract ${config.finP2PContractAddress} is already deployed...`)

    const contractManger = new ContractsManager(config);
    if (await contractManger.isFinP2PContractHealthy(finP2PContractAddress)) {
      console.log('Contract already deployed, skipping migration');
      process.exit(0);
    } else {
      console.log('Contract is not healthy, deploying a new one')
    }
  } else {
    console.log('Contract not deployed yet, deploying a new one');
  }

  return { paymentAssetCode, ...config };
};

const deploy = async (config: FinP2PDeployerConfig): Promise<FinP2PDeployerConfig & {
  finP2PContractAddress: string
}> => {
  const { operatorAddress, paymentAssetCode } = config;
  const contractManger = new ContractsManager(config);
  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode);
  console.log("Contract deployed successfully. FINP2P_CONTRACT_ADDRESS=", finP2PContractAddress);
  return { finP2PContractAddress, ...config };
};

const configFile = process.env.CONFIG_FILE;
if (!configFile) {
  console.error("Please provide the config file path using the CONFIG_FILE environment variable");
  process.exit(1);
}

console.log(`Reading config from ${configFile}...`)

readConfig<FinP2PDeployerConfig>(configFile)
  .catch(e => {
    console.error(`Config file ${configFile} wasn't found:`, e)
    return configFromEnv()
  })
  .then((config) => isAlreadyDeployed(config))
  .then((config) => deploy(config))
  .then((config) => {
    console.log(`Writing config to ${configFile}...`)
    console.log(JSON.stringify(config))
    return writeConfig(config, configFile)
  });
