import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import { EthereumConfig, readEthereumConfig, writeEthereumConfig } from "../src/contracts/ethereumConfig";
import console from "console";


const deploy = async (config: EthereumConfig) => {
  if (!configFile) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  const contractManger = new ContractsManager(config);
  config.finP2PContractAddress = await contractManger.deployFinP2PContract(config.operatorAddress);
  console.log("Contract deployed successfully. FINP2P_CONTRACT_ADDRESS=", config.finP2PContractAddress);
  await writeEthereumConfig(configFile, config);
};

const configFile = process.argv[2] || "";

readEthereumConfig(configFile)
  .then((config) => deploy(config));
