import {
  LedgerAPI,
  Source,
  Destination,
  assetFromAPI,
  sourceFromAPI,
  destinationFromAPI,
  executionContextOptFromAPI,
  signatureFromAPI, hashEIP712, verifyEIP712
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  createProviderAndSigner,
  finIdToAddress,
  FinP2PContract,
  ProviderType, detectSigner
} from "../finp2p-contracts/src";
import winston, { format, transports } from "winston";
import { extractEIP712Params } from "../src/services/helpers";
import process from "process";
import console from "console";
import * as fs from "node:fs";

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.json()
});


type RequestWithSignature =
  LedgerAPI["schemas"]["TransferAssetRequest"] |
  LedgerAPI["schemas"]["HoldOperationRequest"] |
  LedgerAPI["schemas"]["RedeemAssetsRequest"]


const parseRequest = (request: RequestWithSignature) => {
  const { nonce } = request;

  const asset = assetFromAPI(request.asset);
  let source: Source | undefined;
  if ("account" in request.source) {
    source = sourceFromAPI(request.source as LedgerAPI["schemas"]["source"]);
  } else {
    const { finId } = request.source as LedgerAPI["schemas"]["finIdAccount"];
    source = sourceFromAPI({ finId, account: { type: "finId", finId } });
  }
  let destination: Destination | undefined;
  if ("destination" in request && request.destination) {
    const { destination: dst } = request;
    destination = destinationFromAPI(dst);
  }
  const signature = signatureFromAPI(request.signature);
  const exCtx = executionContextOptFromAPI(request.executionContext);

  return { nonce, asset, source, destination, signature, exCtx };
};

const verifySignature = async (
  providerType: ProviderType,
  finp2pContractAddress: string,
  requestPayload: string) => {

  logger.info("Verifying request signature");

  const { nonce, source, destination, asset: ast, signature: sgn, exCtx } =
    parseRequest(JSON.parse(requestPayload) as RequestWithSignature);
  if (!exCtx) {
    throw new Error("Execution context is required in the request for signature verification");
  }
  const { signature, template } = sgn;
  if (template.type != "EIP712") {
    throw new Error(`Unsupported signature template type: ${template.type}`);
  }
  const { hash: payloadHash } = template;

  const { buyerFinId, sellerFinId, asset, settlement, loan, params } =
    extractEIP712Params(ast, source, destination, undefined, template, exCtx);
  const { domain, types, message } = template;
  const { chainId, verifyingContract } = domain;
  if (!chainId) {
    throw new Error("EIP712 domain is missing chainId");
  }
  if (!verifyingContract) {
    throw new Error("EIP712 domain is missing verifyingContract");
  }

  const { eip712PrimaryType: primaryType } = params;
  const signerFinId = detectSigner(params, buyerFinId, sellerFinId);

  const signerAddress = finIdToAddress(signerFinId);
  const offChainHash = hashEIP712(chainId, verifyingContract, types, message);
  if (offChainHash === payloadHash) {
    logger.info("Off-chain hash matches payload hash");
  } else {
    logger.error(`Off-chain hash does not match payload hash: ${offChainHash} != ${payloadHash}`);
  }
  if (verifyEIP712(chainId, verifyingContract, types, message, signerAddress, `0x${signature}`)) {
    logger.info("Off-chain signature verification succeeded");
  } else {
    logger.error("Off-chain signature verification failed");
  }

  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  logger.info(`Using FinP2P contract at address ${finp2pContractAddress} 
    of ${JSON.stringify(await provider.getNetwork())} network`);
  const finP2PContract = new FinP2PContract(provider, signer, finp2pContractAddress, logger);
  const onChainHash = await finP2PContract.hashInvestment(
    primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, loan);
  if (payloadHash === onChainHash) {
    logger.info("On-chain hash matches payload hash");
  } else {
    logger.error(`On-chain hash does not match payload hash: ${onChainHash} != ${payloadHash}`);
  }

  if (await finP2PContract.verifyInvestmentSignature(
    primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, loan, signerFinId, signature)) {
    logger.info("On-chain signature verification succeeded");
  } else {
    logger.error("On-chain signature verification failed");
  }

};

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;
if (!providerType) {
  console.error("Env variable PROVIDER_TYPE was not set");
  process.exit(1);
}

const contractAddress = process.env.FINP2P_CONTRACT_ADDRESS || process.env.TOKEN_ADDRESS;
if (!contractAddress) {
  console.error("Env variable FINP2P_CONTRACT_ADDRESS was not set");
  process.exit(1);
}

// const requestPayload = process.argv[2];
// if (!requestPayload) {
//   console.error("Request payload argument was not provided");
//   process.exit(1);
// }
const requestFile = process.env.REQUEST_FILE;
if (!requestFile) {
  console.error("Env variable REQUEST_FILE was not set");
  process.exit(1);
}
const requestPayload = fs.readFileSync(requestFile, "utf-8");
verifySignature(providerType, contractAddress, requestPayload).catch(console.error);
