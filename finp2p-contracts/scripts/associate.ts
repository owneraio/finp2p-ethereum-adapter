import process from "process";
import { FinP2PContract, createProviderAndSigner, ProviderType } from "../src";
import { Logger, ConsoleLogger } from "../src/logger";
import { keccak256, toUtf8Bytes } from "ethers";

const logger: Logger = new ConsoleLogger('info')

const associateAsset = async (providerType: ProviderType,finp2pContractAddress: string, assetId: string, erc20Address: string, tokenStandard: string) => {
  logger.info(`Granting asset manager and transaction manager roles finP2P contract ${finp2pContractAddress}`);
  const { provider, signer } = await createProviderAndSigner(providerType, logger);

  const finP2P = new FinP2PContract(provider, signer, finp2pContractAddress, logger);
  await finP2P.associateAsset(assetId, erc20Address, keccak256(toUtf8Bytes(tokenStandard)));
  logger.info("Asset associated successfully");
};

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;
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

associateAsset(providerType, finp2pContractAddress, assetId, erc20Address, tokenStandard)
  .then(() => {
  });
