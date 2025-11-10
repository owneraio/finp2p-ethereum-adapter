import process from "process";
import { FinP2PContract } from "../src";
import { keccak256, toUtf8Bytes } from "ethers";
import { createJsonProvider, buildNetworkRpcUrl } from "./config";
import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";

const logger: Logger = new ConsoleLogger("info");

const associateAsset = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  finp2pContractAddress: string,
  assetId: string,
  erc20Address: string,
  tokenStandard: string
) => {
  logger.info(`Granting asset manager and transaction manager roles finP2P contract ${finp2pContractAddress}`);

  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl, logger);

  const finP2P = new FinP2PContract(provider, signer, finp2pContractAddress, logger);
  await finP2P.associateAsset(assetId, erc20Address, keccak256(toUtf8Bytes(tokenStandard)));
  logger.info("Asset associated successfully");
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
const assetId = process.env.ASSET_ID;
if (!assetId) {
  throw new Error("ASSET_ID is not set");
}
const tokenStandard = process.env.TOKEN_STANDARD || "ERC20_WITH_OPERATOR";

const erc20Address = process.env.ERC20_ADDRESS;
if (!erc20Address) {
  throw new Error("ERC20_ADDRESS is not set");
}

associateAsset(operatorPrivateKey, ethereumRPCUrl, finp2pContractAddress, assetId, erc20Address, tokenStandard)
  .then(() => {
  });
