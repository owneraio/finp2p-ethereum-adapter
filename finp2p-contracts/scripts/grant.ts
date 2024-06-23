import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import { ContractManagerConfig } from "../src/contracts/config";
import console from "console";

const grant = async (config: ContractManagerConfig) => {
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  console.log("Granting asset manager and transaction manager roles finP2P contract", finp2pContractAddress);
  const contractManger = new ContractsManager(config);
  await contractManger.grantAssetManagerRole(finp2pContractAddress, operatorAddress);
  await contractManger.grantTransactionManagerRole(finp2pContractAddress, operatorAddress);
};

const ethereumRPCUrl = process.argv[2] || "";
const finp2pContractAddress = process.argv[3] || "";
const deployerPrivateKey = process.argv[4] || "";
const operatorAddress = process.argv[5] || "";

const config = {
  rpcURL: ethereumRPCUrl,
  signerPrivateKey: deployerPrivateKey,
  finP2PContractAddress: finp2pContractAddress,
  operatorAddress: operatorAddress,
} as ContractManagerConfig;

grant(config)
  .then(() => {
  });