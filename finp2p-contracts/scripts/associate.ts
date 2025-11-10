import { FinP2PContract } from "../src";
import { keccak256, toUtf8Bytes } from "ethers";
import { createJsonProvider, parseConfig } from "./config";
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

  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);

  const finP2P = new FinP2PContract(provider, signer, finp2pContractAddress, logger);
  await finP2P.associateAsset(assetId, erc20Address, keccak256(toUtf8Bytes(tokenStandard)));
  logger.info("Asset associated successfully");
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
    name: "finp2p_contract_address",
    envVar: "FINP2P_CONTRACT_ADDRESS",
    description: "FinP2P contract address",
    required: true
  },
  {
    name: "asset_id",
    envVar: "ASSET_ID",
    description: "Asset ID to associate",
    required: true
  },
  {
    name: "token_standard",
    envVar: "TOKEN_STANDARD",
    defaultValue: "ERC20_WITH_OPERATOR",
    description: "Token standard"
  },
  {
    name: "token_address",
    envVar: "TOKEN_ADDRESS",
    description: "Token address to associate",
    required: true
  }
]);

associateAsset(config.operator_pk!, config.rpc_url!, config.finp2p_contract_address!, config.asset_id!, config.token_address!, config.token_standard!)
  .then(() => {
  }).catch(console.error);
