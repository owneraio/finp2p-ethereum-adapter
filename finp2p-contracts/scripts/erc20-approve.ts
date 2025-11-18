#!/usr/bin/env node
import { formatUnits, parseUnits } from "ethers";
import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";
import { FinP2PContract, ERC20Contract } from "../src";
import { createJsonProvider, parseConfig } from "./config";

const logger: Logger = new ConsoleLogger("info");


const erc20Approve = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  finp2pContractAddress: string,
  assetId: string,
  spender: string,
  amount: string
) => {

  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);
  const network = await provider.getNetwork();
  logger.info("Network name: ", network.name);
  logger.info("Network chainId: ", network.chainId);
  const singerAddress = await signer.getAddress();

  const finp2p = new FinP2PContract(provider, signer, finp2pContractAddress, logger);
  const tokenAddress = await finp2p.getAssetAddress(assetId);
  logger.info(`ERC20 token associated with ${assetId} is: ${tokenAddress}`);

  const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
  logger.info("ERC20 token details: ");
  logger.info(`\tname: ${await erc20.name()}`);
  const decimals = await erc20.decimals();

  const allowanceBefore = await erc20.allowance(singerAddress, spender);
  logger.info(`\tallowance before: ${formatUnits(allowanceBefore, decimals)}`);

  const txResp = await erc20.approve(spender, parseUnits(amount, decimals));
  logger.info(`\terc20 approve tx-hash: ${txResp.hash}`);
  await txResp.wait();

  const allowanceAfter = await erc20.allowance(singerAddress, spender);
  logger.info(`\tallowance after: ${formatUnits(allowanceAfter, decimals)}`);


  logger.info(`Approved ${amount} tokens for ${spender} (${spender})`);
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
    description: "Asset ID to approve",
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

erc20Approve(config.operator_pk!, config.rpc_url!, config.finp2p_contract_address!, config.asset_id!, config.spender!, config.amount!)
  .then(() => {
  }).catch(console.error);
