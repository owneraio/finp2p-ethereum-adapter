import console from "console";
import winston, { format, transports } from "winston";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { ERC20_STANDARD_ID, FinP2PContract, AssetType, term } from "@owneraio/finp2p-contracts";
import { emptyOperationParams } from "../src/services/helpers";
import { createJsonProvider, parseConfig } from "../src/config";


const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.json()
});

const syncBalanceFromOssToEthereum = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  ossUrl: string,
  finp2pContractAddress: string
) => {
  const finp2p = new FinP2PClient("", ossUrl);
  const assets = await finp2p.getAssets();
  logger.info(`Got a list of ${assets.length} assets to migrate`);

  if (assets.length === 0) {
    logger.info("No assets to migrate");
    return;
  }

  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);
  const contract = new FinP2PContract(provider, signer, finp2pContractAddress, logger);

  for (const { id: assetId } of assets) {
    try {
      const erc20Address = await contract.getAssetAddress(assetId);
      logger.info(`Found asset ${assetId} with token address ${erc20Address}`);
    } catch (e) {
      if (`${e}`.includes("Asset not found")) {
        logger.info(`Deploying new token for asset ${assetId}`);
        const erc20Address = await contract.deployERC20(assetId, assetId, 0, finp2pContractAddress);
        logger.info(`Associating asset ${assetId} with token ${erc20Address}`);
        let tokenStandard = ERC20_STANDARD_ID;
        // if (identifier) {
        //   const { type, value } = identifier;
        //   if (type === "CUSTOM" && value) {
        //     tokenStandard = keccak256(toUtf8Bytes(value));
        //   }
        // }
        const associateTxHash = await contract.associateAsset(assetId, tokenStandard, erc20Address);
        await contract.waitForCompletion(associateTxHash);
      } else {
        logger.error(`Error migrating asset ${assetId}: ${e}`);
      }
    }

    const owners = await finp2p.getOwnerBalances(assetId);
    for (const { finId, balance: expectedBalance } of owners) {
      const actualBalance = await contract.balance(assetId, finId);
      const balance = parseFloat(expectedBalance) - parseFloat(actualBalance);
      if (balance > 0) {

        logger.info(`Issuing ${balance} asset ${assetId} for finId ${finId}`);
        const issueTx = await contract.issue(finId, term(assetId, AssetType.FinP2P, `${balance}`), emptyOperationParams());
        await contract.waitForCompletion(issueTx);

      } else if (balance < 0) {

        logger.info(`Redeeming ${-balance} asset ${assetId} for finId ${finId}`);
        const issueTx = await contract.redeem(finId, term(assetId, AssetType.FinP2P, `${-balance}`), emptyOperationParams());
        await contract.waitForCompletion(issueTx);
      } else {
        logger.info(`FinId ${finId} already has enough balance for asset ${assetId}: ${balance}`);
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
    name: "oss_url",
    envVar: "OSS_URL",
    description: "FinP2P OSS URL",
    required: true
  },
  {
    name: "finp2p_contract_address",
    envVar: "FINP2P_CONTRACT_ADDRESS",
    description: "FinP2P contract address",
    required: true
  }
]);

syncBalanceFromOssToEthereum(
  config.operator_pk!,
  config.rpc_url!,
  config.oss_url!,
  config.finp2p_contract_address!
).then(() => {
}).catch(console.error);
