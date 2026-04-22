#!/usr/bin/env node
import { formatUnits, parseUnits } from "ethers";
import { Logger, ConsoleLogger } from "../src/adapter-types";
import { ERC20Contract } from "../src";
import { createJsonProvider, parseConfig } from "./config";

const logger: Logger = new ConsoleLogger("info");


const erc20Approve = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  tokenAddress: string,
  spender: string,
  amount: string
) => {

  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);
  const network = await provider.getNetwork();
  logger.info("Network name: ", network.name);
  logger.info("Network chainId: ", network.chainId);
  const signerAddress = await signer.getAddress();

  const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
  logger.info("ERC20 token details: ");
  logger.info(`\tname: ${await erc20.name()}`);
  const decimals = await erc20.decimals();

  const allowanceBefore = await erc20.allowance(signerAddress, spender);
  logger.info(`\tallowance before: ${formatUnits(allowanceBefore, decimals)}`);

  const txResp = await erc20.approve(spender, parseUnits(amount, decimals));
  logger.info(`\terc20 approve tx-hash: ${txResp.hash}`);
  await txResp.wait();

  const allowanceAfter = await erc20.allowance(signerAddress, spender);
  logger.info(`\tallowance after: ${formatUnits(allowanceAfter, decimals)}`);


  logger.info(`Approved ${amount} tokens for ${spender}`);
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
    name: "token_address",
    envVar: "TOKEN_ADDRESS",
    description: "ERC20 token address to approve",
    required: true
  },
  {
    name: "spender",
    envVar: "SPENDER",
    description: "Spender address",
    required: true
  },
  {
    name: "amount",
    envVar: "AMOUNT",
    description: "Amount to approve",
    required: true
  }
]);

erc20Approve(config.operator_pk!, config.rpc_url!, config.token_address!, config.spender!, config.amount!)
  .then(() => {
  }).catch(console.error);
