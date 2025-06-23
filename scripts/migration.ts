import { OssClient } from "../src/finp2p/oss.client";
import process from "process";
import { FinP2PContract } from "../finp2p-contracts/src/contracts/finp2p";
import { createProviderAndSigner, ProviderType } from "../finp2p-contracts/src/contracts/config";
import console from "console";
import { EthereumTransactionError } from "../finp2p-contracts/src/contracts/model";
import { ERC20Contract, OPERATOR_ROLE } from "../finp2p-contracts/src/contracts/erc20";
import winston, { format, transports } from "winston";
import { isEthereumAddress } from "../finp2p-contracts/src/contracts/utils";

const logger = winston.createLogger({
  level: 'info',
  transports: [new transports.Console()],
  format: format.json(),
});


const startMigration = async (ossUrl: string, providerType: ProviderType, finp2pContractAddress: string, grantOperator: boolean) => {
  const ossClient = new OssClient(ossUrl, undefined);
  const assets = await ossClient.getAssetsWithTokens()
  logger.info(`Got a list of ${assets.length} assets to migrate`);

  if (assets.length === 0) {
    logger.info('No assets to migrate');
    return;
  }

  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const finP2PContract = new FinP2PContract(provider, signer, finp2pContractAddress, logger);

  let migrated = 0;
  let skipped = 0;
  for (const { assetId, tokenAddress } of assets) {
    if (!isEthereumAddress(tokenAddress)) {
      logger.info(`Token address ${tokenAddress} for asset ${assetId} is not a valid Ethereum address, skipping`);
      continue
    }
    try {
      const foundAddress = await finP2PContract.getAssetAddress(assetId);
      if (foundAddress === tokenAddress) {
        logger.info(`Asset ${assetId} already associated with token ${tokenAddress}`);
        if (grantOperator) {
          const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger)
          if (!await erc20.hasRole(OPERATOR_ROLE, finp2pContractAddress)) {
            await erc20.grantOperatorTo(finp2pContractAddress);
            logger.info('       granting new operator [done]')
          } else {
            logger.info(`       operator already granted for ${tokenAddress}`);
          }
        }
        skipped++;
        continue;
      }
    } catch (e) {
      if (!`${e}`.includes('Asset not found')) {
        throw e;
      }
    }

    try {
      logger.info(`Migrating asset ${assetId} with token address ${tokenAddress}`);
      const txHash = await finP2PContract.associateAsset(assetId, tokenAddress);
      await finP2PContract.waitForCompletion(txHash)
      logger.info('       asset association [done]')
      if (grantOperator) {
        const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger)
        if (!await erc20.hasRole(OPERATOR_ROLE, finp2pContractAddress)) {
          await erc20.grantOperatorTo(finp2pContractAddress);
          logger.info('       granting new operator [done]')
        } else {
          logger.info(`       operator already granted for ${tokenAddress}`);
        }
      }
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
  logger.info(`Migrated ${migrated} of ${assets.length} assets`);
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

const contractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!contractAddress) {
  console.error('Env variable FINP2P_CONTRACT_ADDRESS was not set');
  process.exit(1);
}

const grantOperator = process.env.GRANT_OPERATOR === 'yes';

startMigration(ossUrl, providerType, contractAddress, grantOperator).then(() => {});
