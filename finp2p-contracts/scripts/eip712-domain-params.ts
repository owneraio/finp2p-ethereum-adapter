import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";
import { FinP2PContract } from "../src";
import { createJsonProvider, buildNetworkRpcUrl } from "./config";
import process from "process";

const logger: Logger = new ConsoleLogger("info");


const domainParams = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  finp2pContractAddress: string
) => {
  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl, logger);
  const finp2pContract = new FinP2PContract(provider, signer, finp2pContractAddress, logger);
  const { name, version, chainId, verifyingContract } = await finp2pContract.eip712Domain();
  logger.info(`EIP712 domain: name=${name} version=${version} chainId=${chainId} verifyingContract=${verifyingContract}`);
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


domainParams(operatorPrivateKey, ethereumRPCUrl, finp2pContractAddress)
  .catch((err) => {
    logger.error("Error running domainParams:", err);
    process.exit(1);
  });
