import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import { FinP2PDeployerConfig, FinP2PContractConfig, readConfig, writeConfig } from "../src/contracts/config";
import console from "console";

const deploy = async (config: FinP2PDeployerConfig) => {
  const contractManger = new ContractsManager({
    rpcURL: config.rpcURL,
    signerPrivateKey: config.deployerPrivateKey
  });
  const finP2PContractAddress = await contractManger.deployFinP2PContract(config.operatorAddress);
  console.log("Contract deployed successfully. FINP2P_CONTRACT_ADDRESS=", finP2PContractAddress);
  return {
    rpcURL: config.rpcURL,
    signerPrivateKey: config.signerPrivateKey || "",
    finP2PContractAddress: finP2PContractAddress
  } as FinP2PContractConfig;
};

const inConfigFile = process.argv[2] || "";
const outConfigFile = process.argv[3] || inConfigFile;

readConfig<FinP2PDeployerConfig>(inConfigFile)
  .then((config) => deploy(config))
  .then((config) => writeConfig(config, outConfigFile));
