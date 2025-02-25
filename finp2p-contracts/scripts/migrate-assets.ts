import process from "process";
import console from "console";
import { FinP2PContract } from "../src/contracts/finp2p";
import { createProviderAndSigner, ProviderType } from "../src/contracts/config";

const migrateAssets = async (providerType: ProviderType, oldContractAddress: string, newContractAddress: string,
                              assetIds: string[]) => {
  const { provider, signer } = await createProviderAndSigner(providerType);
  const oldContract = new FinP2PContract(provider, signer, oldContractAddress);
  const newContract = new FinP2PContract(provider, signer, newContractAddress);
  for (const assetId of assetIds) {
    console.log("Associating asset", assetId);
    const erc20Address = await oldContract.getAssetAddress(assetId);
    console.log(`ERC20 token associated with ${assetId} is: ${erc20Address}`);
    await newContract.associateAsset(assetId, erc20Address);
    console.log("Asset associated successfully");
  }
};

const providerType = (process.env.PROVIDER_TYPE || 'local') as ProviderType;
const oldFinp2pContractAddress = process.env.OLD_FINP2P_CONTRACT_ADDRESS;
if (!oldFinp2pContractAddress) {
  throw new Error("OLD_FINP2P_CONTRACT_ADDRESS is not set");
}

const newFinp2pContractAddress = process.env.NEW_FINP2P_CONTRACT_ADDRESS;
if (!newFinp2pContractAddress) {
  throw new Error("NEW_FINP2P_CONTRACT_ADDRESS is not set");
}
const assetIdsEnv = process.env.ASSET_IDS;
if (!assetIdsEnv) {
  throw new Error("ASSET_IDS is not set");
}

migrateAssets(providerType, oldFinp2pContractAddress, newFinp2pContractAddress, assetIdsEnv.split(','))
  .then(() => {
  });