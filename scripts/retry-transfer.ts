#!/usr/bin/env node
import console from "console";
import winston, { format, transports } from "winston";
import { ERC20Contract, FinP2PContract } from "@owneraio/finp2p-contracts";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { createJsonProvider, parseConfig } from "../src/config";
import { ProofProvider, assetFromAPI, destinationFromAPI, executionContextOptFromAPI, signatureFromAPI, sourceFromAPI } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { TokenServiceImpl } from "../src/services";

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.json()
});

const retryTransfer = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  orgId: string,
  ossUrl: string,
  contractAddress: string,
  idempotencyKey: string,
  requestObject: any
) => {
  const finp2p = new FinP2PClient("", ossUrl)
  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);
  const signerAddress = await signer.getAddress();
  const finp2pContract = new FinP2PContract(provider, signer, contractAddress, logger)

  const { nonce, source, destination, asset, quantity, signature, executionContext } = requestObject;
  const src = sourceFromAPI(source);
  const dst = destinationFromAPI(destination);
  const ast = assetFromAPI(asset);
  const sgn = signatureFromAPI(signature);
  const exCtx = executionContextOptFromAPI(executionContext);

  const proofProvider = new ProofProvider(orgId, finp2p, operatorPrivateKey);
  const tokensService = new TokenServiceImpl(finp2pContract, finp2p, undefined, proofProvider, undefined)

  const receipt = tokensService.transfer(idempotencyKey, nonce, src, dst, ast, quantity, signature, executionContext)
  logger.info({
    msg: 'Transfer executed',
    receipt
  })

  logger.info("Migration complete");
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
    name: "org_id",
    envVar: "ORGANIZATION_ID",
    required: true,
    description: "Current organization ID. required for proof manager"
  },
  {
    name: "finp2p_contract_address",
    envVar: "FINP2P_CONTRACT_ADDRESS",
    description: "FinP2P contract address",
    required: true
  },
  {
    name: "oss_url",
    envVar: "OSS_URL",
    description: "FinP2P OSS URL",
    required: true
  },
  {
    name: "idempotency_key",
    envVar: "IDEMPOTENCY_KEY",
    description: "Idempotency key used for retrying the transfer request",
    required: true
  },
  {
    name: "request_body",
    envVar: "REQUEST_BODY",
    description: "Original transfer request body. Can be obtained from grafana",
    required: true
  }
]);

retryTransfer(
  config.operator_pk!,
  config.rpc_url!,
  config.org_id!,
  config.oss_url!,
  config.finp2p_contract_address!,
  config.idempotency_key!,
  JSON.parse(config.request_body!)
).then(() => {
}).catch(console.error);
