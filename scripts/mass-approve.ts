import console from "console";
import winston, { format, transports } from "winston";
import { ERC20Contract } from "@owneraio/finp2p-contracts";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { createJsonProvider, parseConfig } from "../src/config";

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.json()
});

const massApprove = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  ossUrl: string,
  contractAddress: string,
  amount: bigint
) => {
  const finp2p = new FinP2PClient("", ossUrl);
  const assets = await finp2p.getAssets();
  logger.info(`Got a list of ${assets.length} assets to migrate`);

  if (assets.length === 0) {
    logger.info("No assets to migrate");
    return;
  }

  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);
  const signerAddress = await signer.getAddress();
  for (const { id: assetId, ledgerAssetInfo: { tokenId: tokenAddress } } of assets) {
    try {
      const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
      const decimals = await erc20.decimals();
      const name = await erc20.name();
      logger.info(`asset ${assetId} (${name}) has ${decimals} decimals`);
      const allowed = await erc20.allowance(signerAddress, contractAddress);
      if (allowed < amount) {
        logger.info(`Approving ${amount} tokens for ${contractAddress} (${contractAddress})`);
        const tx = await erc20.approve(contractAddress, amount - allowed);
        await erc20.waitForCompletion(tx.hash);
      } else {
        logger.info(`Already approved ${allowed} tokens for ${contractAddress} (${contractAddress})`);
      }

    } catch (e) {
      if (`${e}`.includes("Asset not found")) {
        logger.info(`Asset ${assetId} not found on old contract`);
      } else {
        logger.error(`Error migrating asset ${assetId}: ${e}`);
      }
    }
  }

  logger.info("Migration complete");
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
    name: "oss_url",
    envVar: "OSS_URL",
    description: "FinP2P OSS URL",
    required: true
  },
  {
    name: "amount",
    envVar: "AMOUNT",
    description: "Amount to approve",
    required: true
  }
]);

massApprove(
  config.operator_pk!,
  config.rpc_url!,
  config.oss_url!,
  config.finp2p_contract_address!,
  BigInt(config.amount!)
).then(() => {
}).catch(console.error);
