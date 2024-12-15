import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import { createProviderAndSigner, ProviderType, readConfig, writeConfig } from "../src/contracts/config";
import console from "console";

type FinP2PDeployerConfig = {
  providerType: ProviderType
  operatorAddress: string
  finP2PContractAddress: string | undefined
  paymentAssetCode: string | undefined
}

const configFromEnv = (): FinP2PDeployerConfig => {
  const providerType = (process.env.PROVIDER_TYPE || 'local') as ProviderType;
  const operatorAddress = process.env.OPERATOR_ADDRESS;
  if (!operatorAddress) {
    throw new Error("OPERATOR_ADDRESS is not set");
  }
  const paymentAssetCode = process.env.PAYMENT_ASSET_CODE;
  return { providerType, operatorAddress, finP2PContractAddress: undefined, paymentAssetCode };
}

const isAlreadyDeployed = async (config: FinP2PDeployerConfig): Promise<FinP2PDeployerConfig> => {
  const { providerType, finP2PContractAddress } = config;
  if (finP2PContractAddress) {
    console.log(`Checking if contract ${finP2PContractAddress} is already deployed...`)

    const { provider, signer } = await createProviderAndSigner(providerType);
    const contractManger = new ContractsManager(provider, signer);
    if (await contractManger.isFinP2PContractHealthy(finP2PContractAddress)) {
      console.log('Contract already deployed, skipping migration');
      throw new Error('Contract already deployed');
    } else {
      console.log('Contract is not healthy, deploying a new one')
    }
  } else {
    console.log('Contract not deployed yet, deploying a new one');
  }
  return config;
};

const deploy = async (config: FinP2PDeployerConfig): Promise<FinP2PDeployerConfig> => {
  const { providerType, operatorAddress, paymentAssetCode } = config;
  const { provider, signer } = await createProviderAndSigner(providerType);
  const contractManger = new ContractsManager(provider, signer);

  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode);
  console.log("Contract deployed successfully. FINP2P_CONTRACT_ADDRESS=", finP2PContractAddress);
  return { providerType, operatorAddress, finP2PContractAddress, paymentAssetCode };
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
  .catch(e => {
    if (`${e}`.includes('Contract already deployed')) {
      process.exit(1)
    } else {
      console.error("Error deploying contract:", e)
      process.exit(1)
    }
  })
  .then((config) => {
    console.log(`Writing config to ${configFile}...`)
    console.log(JSON.stringify(config))
    return writeConfig(config, configFile)
  });
