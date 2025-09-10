import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import { createProviderAndSigner, ProviderType } from "../src/contracts/config";
import winston, { format, transports } from "winston";

const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});

const deploy = async (providerType: ProviderType, operatorAddress: string, finP2PContractAddress: string, paymentAssetCode: string, tokenDecimals: number) => {
  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const contractManger = new ContractsManager(provider, signer, logger);
  logger.info("Deploying from env variables...");
  const erc20Address = await contractManger.deployERC20(paymentAssetCode, paymentAssetCode, tokenDecimals, finP2PContractAddress)
  logger.info(JSON.stringify({ finP2PContractAddress, erc20Address }));
};

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;
const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}
const paymentAssetCode = process.env.PAYMENT_ASSET_CODE;
if (!paymentAssetCode) {
  throw new Error('PAYMENT_ASSET_CODE is not set')
}

const finP2PContractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!finP2PContractAddress) {
  throw new Error('FINP2P_CONTRACT_ADDRESS is not set')
}

const tokenDecimals = Number(process.env.TOKEN_DECIMALS)
if (!tokenDecimals) {
  throw new Error('TOKEN_DECIMALS is not set or misconfigured')
}


deploy(providerType, operatorAddress, finP2PContractAddress, paymentAssetCode, tokenDecimals)
  .then(() => {
  });
