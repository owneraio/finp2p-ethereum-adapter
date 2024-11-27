import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import console from "console";
import { FinP2PDeployerConfig } from "../src/contracts/config";
import fs from "node:fs";
import { ApiBaseUrl, ChainId } from "@fireblocks/fireblocks-web3-provider";

const deploy = async (config: FinP2PDeployerConfig) => {
  const contractManger = new ContractsManager(config);
  console.log('Deploying from env variables...')
  const { operatorAddress, paymentAssetCode, hashType } = config;
  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode, hashType);
  console.log(JSON.stringify({ finP2PContractAddress }));
};

const fbPrivateKeyPath = process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH || "";
if (!fbPrivateKeyPath) {
  throw new Error("FIREBLOCKS_API_PRIVATE_KEY_PATH is not set");
}
const privateKey = fs.readFileSync(fbPrivateKeyPath, "utf-8");
const apiKey = process.env.FIREBLOCKS_API_KEY || "";
if (!apiKey) {
  throw new Error("FIREBLOCKS_API_KEY is not set");
}
const chainId = (process.env.FIREBLOCKS_CHAIN_ID || ChainId.MAINNET) as ChainId;
const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as ApiBaseUrl
const vaultAccountIds = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS?.split(',').map((id) => parseInt(id)) || [];

const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}
const paymentAssetCode = process.env.PAYMENT_ASSET_CODE;

deploy({ privateKey, apiKey, chainId, apiBaseUrl, vaultAccountIds, operatorAddress, paymentAssetCode })
  .then(() => {
  });