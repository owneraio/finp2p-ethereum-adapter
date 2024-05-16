import process from "process";
import console from "console";
import { FinP2PContract } from "../src/contracts/finp2p";
import { EthereumConfig } from "../src/contracts/ethereumConfig";

const associateAsset = async (config: EthereumConfig, assetId: string, erc20Address: string) => {
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  console.log("Granting asset manager and transaction manager roles finP2P contract", finp2pContractAddress);
  const manager = new FinP2PContract(config);
  await manager.associateAsset(assetId, erc20Address);
  console.log("Asset associated successfully");
};

const ethereumRPCUrl = process.argv[2] || "";
const finp2pContractAddress = process.argv[3] || "";
const deployerPrivateKey = process.argv[4] || "";
const assetId = process.argv[5] || "";
const erc20Address = process.argv[6] || "";

const config = {
  rpcURL: ethereumRPCUrl,
  signerPrivateKey: deployerPrivateKey,
  finP2PContractAddress: finp2pContractAddress,
} as EthereumConfig;

associateAsset(config, assetId, erc20Address)
  .then(() => {
  });