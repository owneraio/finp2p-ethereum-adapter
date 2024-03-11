import process from "process";
import { NonceManager, Wallet } from "ethers";
import { ContractsManager } from "../src/contracts/manager";
import console from "console";

const deploy = async (ethereumRPCUrl: string, deployerPrivateKey: string, operatorPrivateKey: string) => {
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  const deployer = new NonceManager(new Wallet(deployerPrivateKey));
  let operatorAddress: string | null = null;
  if (operatorPrivateKey !== "") {
    operatorAddress = new Wallet(operatorPrivateKey).address;
  }
  const contractManger = new ContractsManager(ethereumRPCUrl, deployer);
  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress);
  console.log("FINP2P_CONTRACT_ADDRESS=", finP2PContractAddress);
};

const ethereumRPCUrl = process.argv[2] || "";
const deployerPrivateKey1 = process.argv[3] || "";
const operatorPrivateKey = process.argv[4] || "";
deploy(ethereumRPCUrl, deployerPrivateKey1, operatorPrivateKey)
  .then(() => {
  });