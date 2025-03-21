import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import { createProviderAndSigner, ProviderType } from "../src/contracts/config";
import winston, { format, transports } from "winston";

const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});

const grant = async (providerType: ProviderType, finp2pContractAddress: string, operatorAddress: string) => {
  logger.info(`Granting asset manager and transaction manager roles finP2P contract: ${finp2pContractAddress}`);
  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const contractManger = new ContractsManager(provider, signer, logger);
  await contractManger.grantAssetManagerRole(finp2pContractAddress, operatorAddress);
  await contractManger.grantTransactionManagerRole(finp2pContractAddress, operatorAddress);
};

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;
const finp2pContractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!finp2pContractAddress) {
  throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
}
const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}
grant(providerType, finp2pContractAddress, operatorAddress)
  .then(() => {
  });