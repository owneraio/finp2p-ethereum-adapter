import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import { createProviderAndSigner, ProviderType } from "../src/contracts/config";
import winston, { format, transports } from "winston";

const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});

const deploy = async (providerType: ProviderType, operatorAddress: string,
                      paymentAssetCode: string | undefined,
                      extraDomain: {
                        chainId: number | bigint,
                        verifyingContract: string
                      } | undefined = undefined) => {
  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const contractManger = new ContractsManager(provider, signer, logger);
  logger.info("Deploying from env variables...");
  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode, extraDomain);
  logger.info(JSON.stringify({ finP2PContractAddress }));
};

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;
const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}
const paymentAssetCode = process.env.PAYMENT_ASSET_CODE;

let extraDomain: {
  chainId: number | bigint,
  verifyingContract: string
} | undefined = undefined;
const extraDomainStr = process.env.EXTRA_DOMAIN || "1:0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";
const spl = extraDomainStr.split(":");
if (spl.length !== 2) {
  throw new Error("Invalid EXTRA_DOMAIN format");
}
extraDomain = {
  chainId: parseInt(spl[0]),
  verifyingContract: spl[1]
};

deploy(providerType, operatorAddress, paymentAssetCode, extraDomain)
  .then(() => {
  });