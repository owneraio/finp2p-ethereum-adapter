#!/usr/bin/env node
import console from "console";
import winston, { format, transports } from "winston";
import { ERC20Contract } from "@owneraio/finp2p-contracts";
import { createJsonProvider, parseConfig } from "../src/config";

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.json()
});

const approveAll = async (
  privateKey: string,
  rpcUrl: string,
  tokenAddress: string,
  spenderAddress: string
) => {
  const { provider, signer } = createJsonProvider(privateKey, rpcUrl, false);
  const ownerAddress = await signer.getAddress();

  const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
  const [name, symbol, decimals, balance, currentAllowance] = await Promise.all([
    erc20.name(),
    erc20.symbol(),
    erc20.decimals(),
    erc20.balanceOf(ownerAddress),
    erc20.allowance(ownerAddress, spenderAddress)
  ]);

  logger.info(
    `Token ${name} (${symbol}) decimals=${decimals} owner=${ownerAddress} balance=${balance} currentAllowance=${currentAllowance} spender=${spenderAddress}`
  );

  if (balance === 0n) {
    logger.warn(`Owner ${ownerAddress} has zero balance for token ${tokenAddress}, nothing to approve`);
    return;
  }

  if (currentAllowance >= balance) {
    logger.info(`Allowance ${currentAllowance} already covers balance ${balance}, no action needed`);
    return;
  }

  logger.info(`Approving ${balance} tokens from ${ownerAddress} to ${spenderAddress}`);
  const tx = await erc20.approve(spenderAddress, balance);
  logger.info(`Approve tx submitted: ${tx.hash}`);
  const receipt = await erc20.waitForCompletion(tx.hash);
  logger.info(`Approve tx mined in block ${receipt.blockNumber}`);

  const newAllowance = await erc20.allowance(ownerAddress, spenderAddress);
  logger.info(`New allowance: ${newAllowance}`);
};

const config = parseConfig([
  {
    name: "private_key",
    envVar: "PRIVATE_KEY",
    required: true,
    description: "Wallet private key (the token owner that grants the allowance)"
  },
  {
    name: "rpc_url",
    envVar: "RPC_URL",
    required: true,
    description: "EVM JSON-RPC URL"
  },
  {
    name: "token_address",
    envVar: "TOKEN_ADDRESS",
    required: true,
    description: "ERC20 token contract address"
  },
  {
    name: "spender_address",
    envVar: "SPENDER_ADDRESS",
    required: true,
    description: "Address that will receive the allowance"
  }
]);

approveAll(
  config.private_key!,
  config.rpc_url!,
  config.token_address!,
  config.spender_address!
).then(() => {
  process.exit(0);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
