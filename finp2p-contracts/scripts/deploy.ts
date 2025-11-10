#!/usr/bin/env node
import process from "process";
import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";
import { ContractsManager } from "../src";
import { createProviderAndSigner, ProviderType } from "./config";

const logger: Logger = new ConsoleLogger("info");

const deploy = async (providerType: ProviderType, operatorAddress: string, paymentAssetCode: string | undefined) => {
  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const contractManger = new ContractsManager(provider, signer, logger);
  logger.info("Deploying from env variables...");
  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode);
  logger.info(JSON.stringify({ finP2PContractAddress }));
};

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;
const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}
const paymentAssetCode = process.env.PAYMENT_ASSET_CODE;

deploy(providerType, operatorAddress, paymentAssetCode)
  .then(() => {
  });
