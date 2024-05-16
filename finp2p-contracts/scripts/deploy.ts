import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import console from "console";
import { EthereumConfig } from "../src/contracts/ethereumConfig";

const deploy = async (config: EthereumConfig) => {
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  const contractManger = new ContractsManager(config);
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
} as EthereumConfig;

deploy(config)
  .then(() => {
  });