import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";
import { ContractsManager } from "../src";
import { createJsonProvider, parseConfig } from "./config";

const logger: Logger = new ConsoleLogger("info");


const deploy = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  operatorAddress: string,
  assetName: string,
  assetSymbol: string,
  tokenDecimals: number
) => {
  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);
  const contractManger = new ContractsManager(provider, signer, logger);
  logger.info("Deploying from env variables...");
  const erc20Address = await contractManger.deployERC20(assetName, assetSymbol, tokenDecimals, operatorAddress);
  logger.info(JSON.stringify({ erc20Address }));
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
    name: "operator_address",
    envVar: "OPERATOR_ADDRESS",
    description: "Operator address",
    required: true
  },
  {
    name: "asset_name",
    envVar: "ASSET_NAME",
    description: "Asset name",
    required: true
  },
  {
    name: "asset_symbol",
    envVar: "ASSET_SYMBOL",
    description: "Asset symbol",
    required: true
  },
  {
    name: "token_decimals",
    envVar: "TOKEN_DECIMALS",
    description: "Token decimals",
    required: true
  }
]);


deploy(config.operator_pk!, config.rpc_url!, config.operator_address!, config.asset_name!, config.asset_symbol!, parseInt(config.token_decimals!))
  .then(() => {
  }).catch(console.error);
