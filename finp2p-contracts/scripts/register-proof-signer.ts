#!/usr/bin/env node
import { Logger, ConsoleLogger } from "../src/adapter-types";
import { FinP2POrchestratorContract } from "../src";
import { createJsonProvider, parseConfig } from "./config";

const logger: Logger = new ConsoleLogger("info");

const register = async (
  privateKey: string,
  ethereumRPCUrl: string,
  orchestratorAddress: string,
  orgId: string,
  signerAddress: string | undefined,
  signerFinId: string | undefined
) => {
  if (!signerAddress && !signerFinId) {
    throw new Error("Either SIGNER_ADDRESS or SIGNER_FIN_ID is required");
  }
  const { provider, signer } = await createJsonProvider(privateKey, ethereumRPCUrl);
  const orchestrator = new FinP2POrchestratorContract(provider, signer, orchestratorAddress, logger);
  if (signerAddress) {
    logger.info(`Registering proof signer ${signerAddress} for org ${orgId}...`);
    await orchestrator.addProofSigner(orgId, signerAddress);
  } else {
    logger.info(`Registering proof signer finId ${signerFinId} for org ${orgId}...`);
    await orchestrator.addProofSignerFinId(orgId, signerFinId!);
  }
  logger.info("Proof signer registered");
};

const config = parseConfig([
  {
    name: "asset_manager_pk",
    envVar: "ASSET_MANAGER_PRIVATE_KEY",
    required: true,
    description: "Private key of an account holding the ASSET_MANAGER role"
  },
  {
    name: "rpc_url",
    envVar: "RPC_URL",
    required: true,
    description: "Ethereum RPC URL"
  },
  {
    name: "orchestrator_address",
    envVar: "FINP2P_ORCHESTRATOR_ADDRESS",
    required: true,
    description: "FINP2POrchestrator contract address"
  },
  {
    name: "org_id",
    envVar: "ORG_ID",
    required: true,
    description: "Organization whose proofs the signer attests"
  },
  {
    name: "signer_address",
    envVar: "SIGNER_ADDRESS",
    description: "Proof signer Ethereum address"
  },
  {
    name: "signer_fin_id",
    envVar: "SIGNER_FIN_ID",
    description: "Proof signer finId (compressed public key)"
  }
]);

register(
  config.asset_manager_pk!, config.rpc_url!, config.orchestrator_address!,
  config.org_id!, config.signer_address, config.signer_fin_id
).then(() => {
}).catch(console.error);
