#!/usr/bin/env node
import process from "process";
import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";
import { ContractsManager } from "../src";
import { createJsonProvider, buildNetworkRpcUrl } from "./config";

const logger: Logger = new ConsoleLogger("info");

const deploy = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  operatorAddress: string,
  paymentAssetCode: string | undefined
) => {
  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl, logger);
  const contractManger = new ContractsManager(provider, signer, logger);
  logger.info("Deploying from env variables...");
  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode);
  logger.info(JSON.stringify({ finP2PContractAddress }));
};

const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY || "";
if (!operatorPrivateKey) {
  throw new Error("OPERATOR_PRIVATE_KEY is not set");
}

const networkHost = process.env.NETWORK_HOST;
if (!networkHost) {
  throw new Error("NETWORK_HOST is not set");
}
const ethereumRPCAuth = process.env.NETWORK_AUTH;
const ethereumRPCUrl = buildNetworkRpcUrl(networkHost, ethereumRPCAuth);

const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}
const paymentAssetCode = process.env.PAYMENT_ASSET_CODE;

deploy(operatorPrivateKey, ethereumRPCUrl, operatorAddress, paymentAssetCode)
  .then(() => {
  });
