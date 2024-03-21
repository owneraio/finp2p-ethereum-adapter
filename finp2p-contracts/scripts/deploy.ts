import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import console from "console";

const deploy = async (ethereumRPCUrl: string, deployerPrivateKey: string, operatorAddress: string) => {
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  const contractManger = new ContractsManager(ethereumRPCUrl, deployerPrivateKey);
  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress);
  console.log("FINP2P_CONTRACT_ADDRESS=", finP2PContractAddress);
};

const ethereumRPCUrl = process.argv[2] || "";
const deployerPrivateKey1 = process.argv[3] || "";
const operatorAddress = process.argv[4] || "";
deploy(ethereumRPCUrl, deployerPrivateKey1, operatorAddress)
  .then(() => {
  });