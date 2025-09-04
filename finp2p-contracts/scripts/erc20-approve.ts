import process from "process";
import { FinP2PContract } from "../src/contracts/finp2p";
import { createProviderAndSigner, ProviderType } from "../src/contracts/config";
import { ERC20Contract } from "../src/contracts/erc20";
import winston, { format, transports } from "winston";
import { formatUnits, parseUnits } from "ethers";

const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});

const erc20Approve = async (providerType: ProviderType, finp2pContractAddress: string, assetId: string, spender: string, amount: string) => {

  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const network = await provider.getNetwork();
  logger.info("Network name: ", network.name);
  logger.info("Network chainId: ", network.chainId);
  const singerAddress = await signer.getAddress();

  const finp2p = new FinP2PContract(provider, signer, finp2pContractAddress, logger);
  const tokenAddress = await finp2p.getAssetAddress(assetId);
  logger.info(`ERC20 token associated with ${assetId} is: ${tokenAddress}`);

  const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
  logger.info("ERC20 token details: ");
  logger.info(`\tname: ${await erc20.name()}`);
  const decimals = await erc20.decimals();

  const allowanceBefore = await erc20.allowance(singerAddress, spender);
  logger.info(`\tallowance before: ${formatUnits(allowanceBefore, decimals)}`);

  const txResp = await erc20.approve(spender, parseUnits(amount, decimals));
  logger.info(`\terc20 approve tx-hash: ${txResp.hash}`);
  await txResp.wait();

  const allowanceAfter = await erc20.allowance(singerAddress, spender);
  logger.info(`\tallowance after: ${formatUnits(allowanceAfter, decimals)}`);


  logger.info(`Approved ${amount} tokens for ${spender} (${spender})`);
};

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;

const finp2pContractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!finp2pContractAddress) {
  throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
}
const assetId = process.env.ASSET_ID;
if (!assetId) {
  throw new Error("ASSET_ID is not set");
}
const spender = process.env.SPENDER;
if (!spender) {
  throw new Error("SPENDER is not set");
}
const amount = process.env.AMOUNT;
if (!amount) {
  throw new Error("AMOUNT is not set");
}

erc20Approve(providerType, finp2pContractAddress, assetId, spender, amount)
  .then(() => {
  });
