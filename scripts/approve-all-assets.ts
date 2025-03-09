import { OssClient } from "../src/finp2p/oss.client";
import process from "process";
import { FinP2PContract } from "../finp2p-contracts/src/contracts/finp2p";
import { createProviderAndSigner, ProviderType } from "../finp2p-contracts/src/contracts/config";
import console from "console";
import { ERC20Contract } from "../finp2p-contracts/src/contracts/erc20";
import winston, { format, transports } from "winston";

const logger = winston.createLogger({
  level: 'info',
  transports: [new transports.Console()],
  format: format.json(),
});

const approveAllAssets = async (ossUrl: string, providerType: ProviderType, contractAddress: string, amount: bigint) => {
  const ossClient = new OssClient(ossUrl, undefined);
  const assetIds = await ossClient.getAllAssetIds()
  logger.info(`Got a list of ${assetIds.length} assets to migrate`);

  if (assetIds.length === 0) {
    logger.info('No assets to migrate');
    return;
  }

  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const contract = new FinP2PContract(provider, signer, contractAddress, logger);
  const signerAddress = await signer.getAddress();
  for (const assetId of assetIds) {
    try {
      const erc20Address =  await contract.getAssetAddress(assetId);
      logger.info(`Found asset ${assetId} with token address ${erc20Address}`);
      const erc20 = new ERC20Contract(provider, signer, erc20Address, logger);
      const decimals = await erc20.decimals()
      const name = await erc20.name();
      logger.info(`asset ${assetId} (${name}) has ${decimals} decimals`);
      const allowed = await erc20.allowance(signerAddress, contractAddress);
      if (allowed < amount) {
        logger.info(`Approving ${amount} tokens for ${contractAddress} (${contractAddress})`);
        const tx = await erc20.approve(contractAddress, amount - allowed);
        await contract.waitForCompletion(tx.hash);
      } else {
        logger.info(`Already approved ${allowed} tokens for ${contractAddress} (${contractAddress})`);
      }

    } catch (e) {
      if (`${e}`.includes('Asset not found')) {
        logger.info(`Asset ${assetId} not found on old contract`);
      } else {
        logger.error(`Error migrating asset ${assetId}: ${e}`);
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

const providerType = (process.env.PROVIDER_TYPE || 'local') as ProviderType;
if (!providerType) {
  console.error('Env variable PROVIDER_TYPE was not set');
  process.exit(1);
}

const contractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!contractAddress) {
  console.error('Env variable FINP2P_CONTRACT_ADDRESS was not set');
  process.exit(1);
}

const amount = process.env.AMOUNT;
if (!amount) {
  console.error('Env variable AMOUNT was not set');
  process.exit(1);
}
approveAllAssets(ossUrl, providerType, contractAddress, BigInt(amount)).then(() => {});