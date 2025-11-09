import process from "process";
import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";
import { ContractsManager } from "../src";
import { createProviderAndSigner, ProviderType } from "./config";

const logger: Logger = new ConsoleLogger("info");


const deploy = async (providerType: ProviderType, operatorAddress: string, assetName: string, assetSymbol: string, tokenDecimals: number) => {
  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const contractManger = new ContractsManager(provider, signer, logger);
  logger.info("Deploying from env variables...");
  const erc20Address = await contractManger.deployERC20(assetName, assetSymbol, tokenDecimals, operatorAddress);
  logger.info(JSON.stringify({ erc20Address }));
};

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;
const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}
const assetName = process.env.ASSET_NAME;
if (!assetName) {
  throw new Error("ASSET_NAME is not set");
}

const assetSymbol = process.env.ASSET_SYMBOL;
if (!assetSymbol) {
  throw new Error("ASSET_SYMBOL is not set");
}

const tokenDecimals = Number(process.env.TOKEN_DECIMALS);
if (!tokenDecimals) {
  throw new Error("TOKEN_DECIMALS is not set or misconfigured");
}


deploy(providerType, operatorAddress, assetName, assetSymbol, tokenDecimals)
  .then(() => {
  });
