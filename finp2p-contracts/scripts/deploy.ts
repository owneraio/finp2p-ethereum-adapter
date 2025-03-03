import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import { createProviderAndSigner, ProviderType } from "../src/contracts/config";
import winston, { format, transports } from "winston";

const logger = winston.createLogger({
  level: 'INFO',
  transports: [new transports.Console()],
  format: format.json(),
});

const deploy = async (providerType: ProviderType, operatorAddress: string, paymentAssetCode: string | undefined) => {
  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const contractManger = new ContractsManager(provider, signer, logger);
  logger.info('Deploying from env variables...')
  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode);
  logger.info(JSON.stringify({ finP2PContractAddress }));
};

const providerType = (process.env.PROVIDER_TYPE || 'local') as ProviderType;
const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}
const paymentAssetCode = process.env.PAYMENT_ASSET_CODE;

deploy(providerType, operatorAddress, paymentAssetCode)
  .then(() => {
  });