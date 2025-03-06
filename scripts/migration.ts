import { OssClient } from "../src/finp2p/oss.client";
import process from "process";
import { FinP2PContract } from "../finp2p-contracts/src/contracts/finp2p";
import { createProviderAndSigner, ProviderType } from "../finp2p-contracts/src/contracts/config";
import console from "console";
import { EthereumTransactionError } from "../finp2p-contracts/src/contracts/model";
import { ERC20Contract } from "../finp2p-contracts/src/contracts/erc20";
import winston, { format, transports } from "winston";

const logger = winston.createLogger({
  level: 'info',
  transports: [new transports.Console()],
  format: format.json(),
});


const startMigration = async (ossUrl: string, providerType: ProviderType, oldContractAddress: string, newContractAddress: string) => {
  const ossClient = new OssClient(ossUrl, undefined);
  const assetIds = await ossClient.getAllAssetIds()
  logger.info(`Got a list of ${assetIds.length} assets to migrate`);

  if (assetIds.length === 0) {
    logger.info('No assets to migrate');
    return;
  }

  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const oldContract = new FinP2PContract(provider, signer, oldContractAddress, logger);
  const newContract = new FinP2PContract(provider, signer, newContractAddress, logger);

  let migrated = 0;
  let skipped = 0;
  for (const assetId of assetIds) {
    try {
      const tokenAddress = await oldContract.getAssetAddress(assetId);
      logger.info(`Migrating asset ${assetId} with token address ${tokenAddress}`);
      await newContract.associateAsset(assetId, tokenAddress);
      logger.info('       asset association [done]')
      const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger)
      await erc20.grantOperatorTo(newContractAddress);
      logger.info('       granting new operator [done]')
      migrated++;
    } catch (e) {
      if (`${e}`.includes('Asset not found')) {
        logger.info(`Asset ${assetId} not found on old contract`);
        skipped++;
        continue;
      } else if (e instanceof EthereumTransactionError) {
        if (e.reason.includes('Asset already exists')) {
          skipped++;
          continue;
        }
      } else if (`${e}`.includes('must have admin role to grant')) {
        logger.info(`not an admin to grant roles for ${assetId}`)
        continue;
      }
      throw e;
    }
  }

  logger.info('Migration complete');
  logger.info(`Migrated ${migrated} of ${assetIds.length} assets`);
  logger.info(`Skipped ${skipped} assets`);
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

const oldContractAddress = process.env.OLD_CONTRACT_ADDRESS;
if (!oldContractAddress) {
  console.error('Env variable OLD_CONTRACT_ADDRESS was not set');
  process.exit(1);
}

const newContractAddress = process.env.NEW_CONTRACT_ADDRESS;
if (!newContractAddress) {
  console.error('Env variable NEW_CONTRACT_ADDRESS was not set');
  process.exit(1);
}

startMigration(ossUrl, providerType, oldContractAddress, newContractAddress).then(() => {});