import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import console from "console";
import { FinP2PDeployerConfig } from "../src/contracts/config";

const deploy = async (config: FinP2PDeployerConfig) => {
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  const contractManger = new ContractsManager({
    rpcURL: config.rpcURL,
    signerPrivateKey: config.deployerPrivateKey
  });
  console.log('Deploying from env variables...')
  const { operatorAddress, paymentAssetCode, hashType } = config;
  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode, hashType);
  console.log(JSON.stringify({ finP2PContractAddress }));
};

const rpcURL = process.env.RPC_URL;
if (!rpcURL) {
  throw new Error("RPC_URL is not set");
}
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!deployerPrivateKey) {
  throw new Error("DEPLOYER_PRIVATE_KEY is not set");
}
const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}
const paymentAssetCode = process.env.PAYMENT_ASSET_CODE;

deploy({ rpcURL, deployerPrivateKey, operatorAddress, paymentAssetCode })
  .then(() => {
  });