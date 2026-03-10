#!/usr/bin/env node
import * as fs from "fs";
import console from "console";
import winston, { format, transports } from "winston";
import { Contract, parseUnits } from "ethers";
import { ApiBaseUrl, ChainId } from "@fireblocks/fireblocks-web3-provider";
import { finIdToAddress } from "@owneraio/finp2p-contracts";
import { createFireblocksEthersProvider, parseConfig } from "../src/config";

const ERC20_ABI = [
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function mint(address to, uint256 amount)"
];

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.json()
});

const issueTokens = async (
  apiKey: string,
  apiPrivateKey: string,
  chainId: ChainId,
  apiBaseUrl: ApiBaseUrl | string,
  issuerVaultId: string,
  tokenAddress: string,
  finId: string,
  amount: string | undefined
) => {
  const { provider, signer } = await createFireblocksEthersProvider({
    apiKey, privateKey: apiPrivateKey, chainId, apiBaseUrl,
    vaultAccountIds: [issuerVaultId]
  });

  const erc20 = new Contract(tokenAddress, ERC20_ABI, signer);
  const decimals = BigInt(await erc20.decimals());
  const name: string = await erc20.name();

  // Default: 1000 * 10^decimals raw units (i.e. 1000 tokens)
  const quantity = amount !== undefined
    ? parseUnits(amount, decimals)
    : BigInt(1000) * (BigInt(10) ** decimals);

  logger.info(`Issuing ${quantity} raw units of ${name} (${tokenAddress}) to finId ${finId}`);

  const toAddress = finIdToAddress(finId);
  logger.info(`Resolved finId ${finId} -> address ${toAddress}`);

  const tx = await erc20.mint(toAddress, quantity);
  logger.info(`Transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  logger.info(`Transaction confirmed in block ${receipt?.blockNumber}: ${receipt?.hash}`);
};

const config = parseConfig([
  {
    name: "fireblocks_api_key",
    envVar: "FIREBLOCKS_API_KEY",
    required: true,
    description: "Fireblocks API key"
  },
  {
    name: "fireblocks_api_private_key_path",
    envVar: "FIREBLOCKS_API_PRIVATE_KEY_PATH",
    required: true,
    description: "Path to Fireblocks API private key file"
  },
  {
    name: "fireblocks_chain_id",
    envVar: "FIREBLOCKS_CHAIN_ID",
    required: true,
    description: "Fireblocks chain ID"
  },
  {
    name: "fireblocks_api_base_url",
    envVar: "FIREBLOCKS_API_BASE_URL",
    defaultValue: ApiBaseUrl.Production,
    description: "Fireblocks API base URL"
  },
  {
    name: "fireblocks_asset_issuer_vault_id",
    envVar: "FIREBLOCKS_ASSET_ISSUER_VAULT_ID",
    required: true,
    description: "Fireblocks issuer vault ID"
  },
  {
    name: "token_address",
    envVar: "TOKEN_ADDRESS",
    required: true,
    description: "ERC20 token contract address to mint from"
  },
  {
    name: "fin_id",
    envVar: "FIN_ID",
    required: true,
    description: "Recipient FinID (public key hex)"
  },
  {
    name: "amount",
    envVar: "AMOUNT",
    description: "Human-readable amount to issue (e.g. 1000.5). Defaults to 1000 tokens"
  }
]);

const apiPrivateKey = fs.readFileSync(config.fireblocks_api_private_key_path!, "utf-8");

issueTokens(
  config.fireblocks_api_key!,
  apiPrivateKey,
  Number(config.fireblocks_chain_id) as ChainId,
  config.fireblocks_api_base_url!,
  config.fireblocks_asset_issuer_vault_id!,
  config.token_address!,
  config.fin_id!,
  config.amount
).catch(console.error);
