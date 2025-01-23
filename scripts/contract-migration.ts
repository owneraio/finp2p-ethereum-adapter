import { OssClient } from "../src/finp2p/oss.client";
import process from "process";
import { FinP2PContract } from "../finp2p-contracts/src/contracts/finp2p";
import { createProviderAndSigner, ProviderType } from "../finp2p-contracts/src/contracts/config";
import console from "console";


const startMigration = async (ossUrl: string, providerType: ProviderType, oldContractAddress: string, newContractAddress: string) => {
  const ossClient = new OssClient(ossUrl, undefined);
  const assetIds = await ossClient.getAllAssetIds()
  console.log(`Got a list of ${assetIds.length} assets to migrate`);

  const { provider, signer } = await createProviderAndSigner(providerType);
  const oldContract = new FinP2PContract(provider, signer, oldContractAddress);
  const newContract = new FinP2PContract(provider, signer, newContractAddress);

  for (const assetId of assetIds) {
    try {
      const tokenAddress = await oldContract.getAssetAddress(assetId);
      console.log(`Migrating asset ${assetId} with token address ${tokenAddress}`);
      await newContract.associateAsset(assetId, tokenAddress);
      console.log('       [done]')
    } catch (e) {
      console.log(e)
    }
  }

  console.log('Migration complete');
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