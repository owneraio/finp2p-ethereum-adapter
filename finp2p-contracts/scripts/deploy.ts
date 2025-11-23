#!/usr/bin/env node
import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";
import { ContractsManager, FinP2PContract } from "../src";
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
  logger.info(`FINP2P Contract deployed at address: ${finP2PContractAddress}`);
  const finP2P = new FinP2PContract(provider, signer, finP2PContractAddress, logger);

  logger.info("Testing deployed contract...");
  const version = await finP2P.getVersion();
  logger.info(`Deployed FINP2P Contract version: ${version}`);

  const eip712Domain = await finP2P.eip712Domain();
  logger.info(`EIP712 Domain: ${JSON.stringify(eip712Domain)}`);

  const assetRegistryAddress = await finP2P.getAssetRegistryAddress();
  logger.info(`Asset Registry Address: ${assetRegistryAddress}`);
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
