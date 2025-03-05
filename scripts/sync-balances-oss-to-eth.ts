import { OssClient } from "../src/finp2p/oss.client";
import process from "process";
import { FinP2PContract } from "../finp2p-contracts/src/contracts/finp2p";
import { createProviderAndSigner, ProviderType } from "../finp2p-contracts/src/contracts/config";
import console from "console";
import { EthereumTransactionError } from "../finp2p-contracts/src/contracts/model";
import { ERC20Contract } from "../finp2p-contracts/src/contracts/erc20";
import winston, { format, transports } from "winston";
import { term } from "../finp2p-contracts/src/contracts/eip712";

const logger = winston.createLogger({
  level: 'info',
  transports: [new transports.Console()],
  format: format.json(),
});

const syncBalanceFromOssToEthereum = async (ossUrl: string, providerType: ProviderType, contractAddress: string) => {
  const ossClient = new OssClient(ossUrl, undefined);
  const assetIds = await ossClient.getAllAssetIds()
  logger.info(`Got a list of ${assetIds.length} assets to migrate`);

  if (assetIds.length === 0) {
    logger.info('No assets to migrate');
    return;
  }

  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const contract = new FinP2PContract(provider, signer, contractAddress, logger);

  for (const assetId of assetIds) {
    try {
      const erc20Address =  await contract.getAssetAddress(assetId);
      logger.info(`Found asset ${assetId} with token address ${erc20Address}`);
    } catch (e) {
      if (`${e}`.includes('Asset not found')) {
        logger.info(`Deploying new token for asset ${assetId}`);
        const erc20Address = await contract.deployERC20(assetId, assetId, 0, contractAddress);
        logger.info(`Associating asset ${assetId} with token ${erc20Address}`);
        const associateTxHash = await contract.associateAsset(assetId, erc20Address);
        await contract.waitForCompletion(associateTxHash);
      } else {
        logger.error(`Error migrating asset ${assetId}: ${e}`);
      }
    }

    const owners = await ossClient.getOwnerBalances(assetId);
    for (const { finId, balance: expectedBalance } of owners) {
      const actualBalance = await contract.balance(assetId, finId);
      const balance = parseFloat(expectedBalance) - parseFloat(actualBalance);
      if (balance > 0) {

        logger.info(`Issuing ${balance} asset ${assetId} for finId ${finId}`);
        const issueTx = await contract.issue(finId, term(assetId, 'finp2p', `${balance}`));
        await contract.waitForCompletion(issueTx);

      } else if (balance < 0) {

        logger.info(`Redeeming ${-balance} asset ${assetId} for finId ${finId}`);
        const issueTx = await contract.redeem(finId, term(assetId, 'finp2p', `${-balance}`));
        await contract.waitForCompletion(issueTx);
      } else {
        logger.info(`FinId ${finId} already has enough balance for asset ${assetId}: ${balance}`);
      }
    }

  }

  logger.info('Migration complete');
}

const ossUrl = process.env.OSS_URL;
if (!ossUrl) {
  console.error('Env variable OSS_URL was not set');
  process.exit(1);
}

const providerType = process.env.PROVIDER_TYPE as ProviderType;
if (!providerType) {
  console.error('Env variable PROVIDER_TYPE was not set');
  process.exit(1);
}

const contractAddress = process.env.CONTRACT_ADDRESS;
if (!contractAddress) {
  console.error('Env variable CONTRACT_ADDRESS was not set');
  process.exit(1);
}
syncBalanceFromOssToEthereum(ossUrl, providerType, contractAddress).then(() => {});