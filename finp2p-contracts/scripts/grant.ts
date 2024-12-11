import process from "process";
import { ContractsManager } from "../src/contracts/manager";
import console from "console";
import { createProviderAndSigner, ProviderType } from "../src/contracts/config";

const grant = async (providerType: ProviderType, finp2pContractAddress: string, operatorAddress: string) => {
  console.log("Granting asset manager and transaction manager roles finP2P contract", finp2pContractAddress);
  const { provider, signer } = await createProviderAndSigner(providerType);
  const contractManger = new ContractsManager(provider, signer);
  await contractManger.grantAssetManagerRole(finp2pContractAddress, operatorAddress);
  await contractManger.grantTransactionManagerRole(finp2pContractAddress, operatorAddress);
};

const providerType = (process.env.PROVIDER_TYPE || 'local') as ProviderType;
const finp2pContractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!finp2pContractAddress) {
  throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
}
const operatorAddress = process.env.OPERATOR_ADDRESS;
if (!operatorAddress) {
  throw new Error("OPERATOR_ADDRESS is not set");
}
grant(providerType, finp2pContractAddress, operatorAddress)
  .then(() => {
  });