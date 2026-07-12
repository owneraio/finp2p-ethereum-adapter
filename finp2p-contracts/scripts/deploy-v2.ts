#!/usr/bin/env node
import { Logger, ConsoleLogger } from "../src/adapter-types";
import { ContractsManager, FinP2POrchestratorContract } from "../src";
import { createJsonProvider, parseConfig } from "./config";

const logger: Logger = new ConsoleLogger("info");

const deploy = async (
  deployerPrivateKey: string,
  ethereumRPCUrl: string,
  operatorAddress: string,
  escrowAddress: string | undefined,
  verifierAddress: string | undefined
) => {
  const { provider, signer } = await createJsonProvider(deployerPrivateKey, ethereumRPCUrl);
  const contractManager = new ContractsManager(provider, signer, logger);
  logger.info("Deploying v2 (plan-based) contract set...");
  const { orchestratorAddress, escrowAddress: escrow, verifierAddress: verifier } =
    await contractManager.deployFinP2POrchestrator(operatorAddress, escrowAddress, verifierAddress);
  logger.info(`FINP2POrchestrator deployed at: ${orchestratorAddress}`);
  logger.info(`FinP2PEscrow at: ${escrow}`);
  logger.info(`FinP2PPlanVerifier at: ${verifier}`);

  logger.info("Testing deployed contract...");
  const orchestrator = new FinP2POrchestratorContract(provider, signer, orchestratorAddress, logger);
  const version = await orchestrator.getVersion();
  logger.info(`Deployed FINP2POrchestrator version: ${version}`);
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
    name: "escrow_address",
    envVar: "ESCROW_CONTRACT_ADDRESS",
    description: "Existing FinP2PEscrow address (deployed when omitted)"
  },
  {
    name: "verifier_address",
    envVar: "VERIFIER_CONTRACT_ADDRESS",
    description: "Existing FinP2PPlanVerifier address (deployed when omitted)"
  }
]);

deploy(config.deployer_pk!, config.rpc_url!, config.operator!, config.escrow_address, config.verifier_address)
  .then(() => {
  }).catch(console.error);
