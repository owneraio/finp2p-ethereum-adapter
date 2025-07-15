import process from "process";
import { FinP2PContract } from "../src/contracts/finp2p";
import { createProviderAndSigner, ProviderType } from "../src/contracts/config";
import winston, { format, transports } from "winston";

const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});

const associateAsset = async (providerType: ProviderType, deployerPrivateKey: string, finp2pContractAddress: string, assetId: string, erc20Address: string) => {
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  logger.info(`Granting asset manager and transaction manager roles finP2P contract ${finp2pContractAddress}`);
  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const manager = new FinP2PContract(provider, signer, finp2pContractAddress, logger);
  const tokenStandard = 1;
  await manager.associateAsset(assetId, tokenStandard, erc20Address);
  logger.info("Asset associated successfully");
};

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;
const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!deployerPrivateKey) {
  throw new Error("DEPLOYER_PRIVATE_KEY is not set");
}
const finp2pContractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!finp2pContractAddress) {
  throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
}
const assetId = process.env.ASSET_ID;
if (!assetId) {
  throw new Error("ASSET_ID is not set");
}
const erc20Address = process.env.ERC20_ADDRESS;
if (!erc20Address) {
  throw new Error("ERC20_ADDRESS is not set");
}

associateAsset(providerType, deployerPrivateKey, finp2pContractAddress, assetId, erc20Address)
  .then(() => {
  });
