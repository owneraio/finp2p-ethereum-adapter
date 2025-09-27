import console from "console";
import process from "process";
import winston, { format, transports } from "winston";
import { createProviderAndSigner, ProviderType, ERC20Contract } from "@owneraio/finp2p-contracts";
import { FinP2PClient } from "@owneraio/finp2p-client";

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.json()
});

const massApprove = async (ossUrl: string, providerType: ProviderType, contractAddress: string, amount: bigint) => {
  const finp2p = new FinP2PClient("", ossUrl);
  const assets = await finp2p.getAssetsWithTokens();
  logger.info(`Got a list of ${assets.length} assets to migrate`);

  if (assets.length === 0) {
    logger.info("No assets to migrate");
    return;
  }

  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const signerAddress = await signer.getAddress();
  for (const { assetId, ledgerAssetInfo: { tokenId: tokenAddress } } of assets) {
    try {
      const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
      const decimals = await erc20.decimals();
      const name = await erc20.name();
      logger.info(`asset ${assetId} (${name}) has ${decimals} decimals`);
      const allowed = await erc20.allowance(signerAddress, contractAddress);
      if (allowed < amount) {
        logger.info(`Approving ${amount} tokens for ${contractAddress} (${contractAddress})`);
        const tx = await erc20.approve(contractAddress, amount - allowed);
        await erc20.waitForCompletion(tx.hash);
      } else {
        logger.info(`Already approved ${allowed} tokens for ${contractAddress} (${contractAddress})`);
      }

    } catch (e) {
      if (`${e}`.includes("Asset not found")) {
        logger.info(`Asset ${assetId} not found on old contract`);
      } else {
        logger.error(`Error migrating asset ${assetId}: ${e}`);
      }
    }
  }

  logger.info("Migration complete");
};

const ossUrl = process.env.OSS_URL;
if (!ossUrl) {
  console.error("Env variable OSS_URL was not set");
  process.exit(1);
}

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;
if (!providerType) {
  console.error("Env variable PROVIDER_TYPE was not set");
  process.exit(1);
}

const contractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!contractAddress) {
  console.error("Env variable FINP2P_CONTRACT_ADDRESS was not set");
  process.exit(1);
}

const amount = process.env.AMOUNT;
if (!amount) {
  console.error("Env variable AMOUNT was not set");
  process.exit(1);
}
massApprove(ossUrl, providerType, contractAddress, BigInt(amount)).then(() => {
});
