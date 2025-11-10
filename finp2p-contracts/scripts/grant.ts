#!/usr/bin/env node
import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";
import { ContractsManager } from "../src";
import { createJsonProvider, parseConfig } from "./config";

const logger: Logger = new ConsoleLogger("info");

const grant = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  finp2pContractAddress: string,
  operatorAddress: string
) => {
  logger.info(`Granting asset manager and transaction manager roles finP2P contract: ${finp2pContractAddress}`);
  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);
  const contractManger = new ContractsManager(provider, signer, logger);
  await contractManger.grantAssetManagerRole(finp2pContractAddress, operatorAddress);
  await contractManger.grantTransactionManagerRole(finp2pContractAddress, operatorAddress);
};

const config = parseConfig([
  {
    name: "operator_pk",
    envVar: "OPERATOR_PRIVATE_KEY",
    required: true,
    description: "Operator private key"
  },
  {
    name: "rpc_url",
    envVar: "RPC_URL",
    required: true,
    description: "Ethereum RPC URL"
  },
  {
    name: "finp2p_contract_address",
    envVar: "FINP2P_CONTRACT_ADDRESS",
    description: "FinP2P contract address",
    required: true
  },
  {
    name: "operator_address",
    envVar: "OPERATOR_ADDRESS",
    description: "Operator address",
    required: true
  }
]);


grant(config.operator_pk!, config.rpc_url!, config.finp2p_contract_address!, config.operator_address!)
  .then(() => {
  }).catch(console.error);
