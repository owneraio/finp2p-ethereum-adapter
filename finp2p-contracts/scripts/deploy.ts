#!/usr/bin/env node
import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";
import { ContractsManager } from "../src";
import { createJsonProvider, parseConfig } from "./config";

const logger: Logger = new ConsoleLogger("info");

const deploy = async (
  deployerPrivateKey: string,
  ethereumRPCUrl: string,
  operatorAddress: string,
  paymentAssetCode: string | undefined
) => {
  const { provider, signer } = await createJsonProvider(deployerPrivateKey, ethereumRPCUrl);
  const contractManger = new ContractsManager(provider, signer, logger);
  logger.info("Deploying from env variables...");
  const finP2PContractAddress = await contractManger.deployFinP2PContract(operatorAddress, paymentAssetCode);
  logger.info(JSON.stringify({ finP2PContractAddress }));
};

const config = parseConfig([
  {
    name: "deployer_pk",
    envVar: "DEPLOYER_PRIVATE_KEY",
    required: true,
    description: "Deployer private key"
  },
  {
    name: "rpc_url",
    envVar: "RPC_URL",
    required: true,
    description: "Ethereum RPC URL"
  },
  {
    name: "operator",
    envVar: "OPERATOR_ADDRESS",
    description: "Operator address",
    required: true
  },
  {
    name: "payment_asset_code",
    envVar: "PAYMENT_ASSET_CODE",
    description: "Payment asset code"
  }
]);

deploy(config.deployer_pk!, config.rpc_url!, config.operator!, config.payment_asset_code)
  .then(() => {
  }).catch(console.error);
