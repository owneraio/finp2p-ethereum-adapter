import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import console from "console";

const grant = async (ethereumRPCUrl: string, finp2pContractAddress: string, deployerPrivateKey: string, operatorAddress: string) => {
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  console.log("Granting asset manager and transaction manager roles finP2P contract", finp2pContractAddress);
  const contractManger = new ContractsManager(ethereumRPCUrl, deployerPrivateKey);
  await contractManger.grantAssetManagerRole(finp2pContractAddress, operatorAddress);
  await contractManger.grantTransactionManagerRole(finp2pContractAddress, operatorAddress);
};

const ethereumRPCUrl = process.argv[2] || "";
const finp2pContractAddress = process.argv[3] || "";
const deployerPrivateKey = process.argv[4] || "";
const operatorAddress = process.argv[5] || "";
grant(ethereumRPCUrl, finp2pContractAddress, deployerPrivateKey, operatorAddress)
  .then(() => {
  });