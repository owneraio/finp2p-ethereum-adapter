import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import console from "console";
import { FireblocksProviderConfig } from "@fireblocks/fireblocks-web3-provider/dist/src/types";

const grant = async (config: FireblocksProviderConfig & { finp2pContractAddress: string }) => {
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  const { finp2pContractAddress } = config;
  console.log("Granting asset manager and transaction manager roles finP2P contract", finp2pContractAddress);
  const contractManger = new ContractsManager(config);
  await contractManger.grantAssetManagerRole(finp2pContractAddress, operatorAddress);
  await contractManger.grantTransactionManagerRole(finp2pContractAddress, operatorAddress);
};

const apiKey = process.argv[2] || "";
const privateKey = process.argv[3] || "";
const deployerPrivateKey = process.argv[4] || "";
const chainId = parseInt(process.argv[5] || "0");
const apiBaseUrl = process.argv[6] || "";
const finp2pContractAddress = process.argv[7] || "";
const vaultAccountIds = process.argv[8] || "";
const operatorAddress = process.argv[9] || "";

const config = {
  apiKey,
  privateKey,
  chainId,
  apiBaseUrl,
  finp2pContractAddress,
  vaultAccountIds,
  operatorAddress,
};

grant(config)
  .then(() => {
  });