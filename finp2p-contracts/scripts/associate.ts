import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import console from "console";
import { FinP2PContract } from "../src/contracts/finp2p";

const associateAsset = async (ethereumRPCUrl: string, finp2pContractAddress: string, operatorPrivateKey: string, assetId: string, erc20Address: string) => {
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  console.log("Granting asset manager and transaction manager roles finP2P contract", finp2pContractAddress);
  const manager = new FinP2PContract(ethereumRPCUrl, operatorPrivateKey, finp2pContractAddress);
  await manager.associateAsset(assetId, erc20Address);
  console.log("Asset associated successfully");
};

const ethereumRPCUrl = process.argv[2] || "";
const finp2pContractAddress = process.argv[3] || "";
const deployerPrivateKey = process.argv[4] || "";
const assetId = process.argv[5] || "";
const erc20Address = process.argv[6] || "";
associateAsset(ethereumRPCUrl, finp2pContractAddress, deployerPrivateKey, assetId, erc20Address)
  .then(() => {
  });