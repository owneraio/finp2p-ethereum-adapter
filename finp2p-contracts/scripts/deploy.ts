import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import console from "console";
import { ContractManagerConfig, FinP2PDeployerConfig } from "../src/contracts/config";

const deploy = async (config: FinP2PDeployerConfig) => {
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  const contractManger = new ContractsManager({
    rpcURL: config.rpcURL,
    signerPrivateKey: config.deployerPrivateKey
  });
  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress);
  console.log("FINP2P_CONTRACT_ADDRESS=", finP2PContractAddress);
};

const ethereumRPCUrl = process.argv[2] || "";
const deployerPrivateKey = process.argv[3] || "";
const operatorAddress = process.argv[4] || "";

const config = {
  rpcURL: ethereumRPCUrl,
  deployerPrivateKey: deployerPrivateKey,
  operatorAddress: operatorAddress,
} as FinP2PDeployerConfig;

deploy(config)
  .then(() => {
  });