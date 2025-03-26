import { OssClient } from "../src/finp2p/oss.client";
import process from "process";
import { FinP2PContract } from "../finp2p-contracts/src/contracts/finp2p";
import { createProviderAndSigner, ProviderType } from "../finp2p-contracts/src/contracts/config";
import console from "console";
import winston, { format, transports } from "winston";
import { AssetType } from "../finp2p-contracts/src/contracts/model";

const logger = winston.createLogger({
  level: 'info',
  transports: [new transports.Console()],
  format: format.json(),
});

const syncBalanceFromOssToEthereum = async (ossUrl: string, providerType: ProviderType, finp2pContractAddress: string) => {
  const ossClient = new OssClient(ossUrl, undefined);
  const assets = await ossClient.getAssetsWithTokens()
  logger.info(`Got a list of ${assets.length} assets to migrate`);

  if (assets.length === 0) {
    logger.info('No assets to migrate');
    return;
  }

  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const contract = await FinP2PContract.create(provider, signer, finp2pContractAddress, logger);

  for (const { assetId } of assets) {
    try {
      const erc20Address =  await contract.getAssetAddress(assetId);
      logger.info(`Found asset ${assetId} with token address ${erc20Address}`);
    } catch (e) {
      if (`${e}`.includes('Asset not found')) {
        logger.info(`Deploying new token for asset ${assetId}`);
        const erc20Address = await contract.deployERC20(assetId, assetId, 0, finp2pContractAddress);
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
        const issueTx = await contract.issue(finId, assetId, AssetType.FinP2P, `${balance}`);
        await contract.waitForCompletion(issueTx);

      } else if (balance < 0) {

        logger.info(`Redeeming ${-balance} asset ${assetId} for finId ${finId}`);
        const issueTx = await contract.redeem(finId, assetId, AssetType.FinP2P, `${-balance}`);
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

const providerType = (process.env.PROVIDER_TYPE || 'local')  as ProviderType;
if (!providerType) {
  console.error('Env variable PROVIDER_TYPE was not set');
  process.exit(1);
}

const finp2pContractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!finp2pContractAddress) {
  console.error('Env variable FINP2P_CONTRACT_ADDRESS was not set');
  process.exit(1);
}
syncBalanceFromOssToEthereum(ossUrl, providerType, finp2pContractAddress).then(() => {});