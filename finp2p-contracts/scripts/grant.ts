#!/usr/bin/env node
import process from "process";
import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";
import { ContractsManager } from "../src";
import { createJsonProvider, buildNetworkRpcUrl } from "./config";

const logger: Logger = new ConsoleLogger("info");

const grant = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  finp2pContractAddress: string,
  operatorAddress: string
) => {
  logger.info(`Granting asset manager and transaction manager roles finP2P contract: ${finp2pContractAddress}`);
  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl, logger);
  const contractManger = new ContractsManager(provider, signer, logger);
  await contractManger.grantAssetManagerRole(finp2pContractAddress, operatorAddress);
  await contractManger.grantTransactionManagerRole(finp2pContractAddress, operatorAddress);
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

const finp2pContractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!finp2pContractAddress) {
  throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
}
const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}

grant(operatorPrivateKey, ethereumRPCUrl, finp2pContractAddress, operatorAddress)
  .then(() => {
  });
