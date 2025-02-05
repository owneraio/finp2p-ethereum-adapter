import process from "process";
import console from "console";
import { FinP2PContract } from "../src/contracts/finp2p";
import { createProviderAndSigner, ProviderType } from "../src/contracts/config";
import { ERC20Contract } from "../src/contracts/erc20";
import { finIdToEthereumAddress } from "../src/contracts/utils";
import { hexlify, Wallet } from "ethers";


const erc20Approve = async (providerType: ProviderType, finp2pContractAddress: string,
                              assetId: string, spenderFinId: string, amount: number) => {

  const { provider, signer } = await createProviderAndSigner(providerType);
  const network = await provider.getNetwork();
  console.log("Network name: ", network.name);
  console.log("Network chainId: ", network.chainId);
  const finp2p = new FinP2PContract(provider, signer, finp2pContractAddress);
  const tokenAddress = await finp2p.getAssetAddress(assetId);
  console.log(`ERC20 token associated with ${assetId} is: ${tokenAddress}`);

  const erc20 = new ERC20Contract(provider, signer, tokenAddress);
  console.log("ERC20 token details: ");
  console.log(`\tname: ${await erc20.name()}`);

  const spender = finIdToEthereumAddress(`0x${spenderFinId}`);
  await erc20.approve(spender, amount)

  console.log(`Approved ${amount} tokens for ${spenderFinId} (${spender})`);
};

const providerType = (process.env.PROVIDER_TYPE || 'local') as ProviderType;

const finp2pContractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!finp2pContractAddress) {
  throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
}
const assetId = process.env.ASSET_ID;
if (!assetId) {
  throw new Error("ASSET_ID is not set");
}
const spenderFinId = process.env.SPENDER_FIN_ID;
if (!spenderFinId) {
  throw new Error("SPENDER_FIN_ID is not set");
}
const amountStr = process.env.AMOUNT;
if (!amountStr) {
  throw new Error("SPENDER_FIN_ID is not set");
}
const amount = parseInt(amountStr);

erc20Approve(providerType, finp2pContractAddress, assetId, spenderFinId, amount)
  .then(() => {
  });