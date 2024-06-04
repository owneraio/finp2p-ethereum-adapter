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
  const finP2PContractAddress = await contractManger.deployFinP2PContract(config.operatorAddress);
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

deploy({ rpcURL, deployerPrivateKey, operatorAddress })
  .then(() => {
  });