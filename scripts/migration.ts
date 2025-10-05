import winston, { format, transports } from "winston";
import console from "console";
import process from "process";
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  FinP2PContract,
  ERC20Contract,
  ProviderType,
  EthereumTransactionError,
  MINTER_ROLE,
  OPERATOR_ROLE,
  createProviderAndSigner,
  isEthereumAddress
} from "@owneraio/finp2p-contracts";

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.json()
});


const startMigration = async (
  orgId: string, ossUrl: string,
  providerType: ProviderType,
  finp2pContractAddress: string,
  oldFinp2pAddress: string | undefined,
  grantOperator: boolean, grantMinter: boolean) => {
  const finp2p = new FinP2PClient("", ossUrl);
  const assets = await finp2p.getAssets();
  logger.info(`Got a list of ${assets.length} assets to migrate`);

  if (assets.length === 0) {
    logger.info("No assets to migrate");
    return;
  }

  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const finP2PContract = new FinP2PContract(provider, signer, finp2pContractAddress, logger);

  let migrated = 0;
  let skipped = 0;
  for (const { organizationId, id: assetId, ledgerAssetInfo } of assets) {
    if (organizationId !== orgId) {
      continue;
    }
    if (!ledgerAssetInfo) {
      continue;
    }
    const { tokenId, ledgerReference } = ledgerAssetInfo;
    let tokenAddress: string;
    if (ledgerReference) {
      const { address, tokenStandard, additionalContractDetails } = ledgerReference;
      tokenAddress = address;
      // TODO: use tokenStandard instead of `grantOperator` and `grantMinter` params
      // if (additionalContractDetails) {
      //   const { finP2PEVMOperatorDetails: { finP2POperatorContractAddress } } = additionalContractDetails;
      // }
      // TODO: use `finP2POperatorContractAddress` instead of `oldFinp2pAddress` param
    } else {
      if (!isEthereumAddress(tokenId)) {
        continue;
      }
      tokenAddress = tokenId;
    }

    try {
      const foundAddress = await finP2PContract.getAssetAddress(assetId);
      if (foundAddress === tokenAddress) {
        logger.info(`Asset ${assetId} already associated with token ${tokenAddress}`);
        if (grantOperator) {
          const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
          if (!await erc20.hasRole(OPERATOR_ROLE, finp2pContractAddress)) {
            await erc20.grantOperatorTo(finp2pContractAddress);
            logger.info("       granting new operator [done]");
          } else {
            logger.info(`       operator already granted for ${tokenAddress}`);
          }
        }
        if (grantMinter) {
          const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
          if (!await erc20.hasRole(MINTER_ROLE, finp2pContractAddress)) {
            await erc20.grantMinterTo(finp2pContractAddress);
            logger.info("       granting new minter [done]");
          } else {
            logger.info(`       minter already granted for ${tokenAddress}`);
          }
        }
        skipped++;
        continue;
      }
    } catch (e) {
      if (!`${e}`.includes("Asset not found")) {
        throw e;
      }
    }

    try {
      logger.info(`Migrating asset ${assetId} with token address ${tokenAddress}`);
      const txHash = await finP2PContract.associateAsset(assetId, tokenAddress);
      await finP2PContract.waitForCompletion(txHash);
      logger.info("       asset association [done]");
      if (grantOperator) {
        const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
        if (!await erc20.hasRole(OPERATOR_ROLE, finp2pContractAddress)) {
          await erc20.grantOperatorTo(finp2pContractAddress);
          logger.info("       granting new operator [done]");
        } else {
          logger.info(`       operator already granted for ${tokenAddress}`);
        }
      }
      if (grantMinter) {
        const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
        if (!await erc20.hasRole(MINTER_ROLE, finp2pContractAddress)) {
          await erc20.grantMinterTo(finp2pContractAddress);
          logger.info("       granting new minter [done]");
        } else {
          logger.info(`       minter already granted for ${tokenAddress}`);
        }
      }
      migrated++;
    } catch (e) {
      if (`${e}`.includes("Asset not found")) {
        logger.info(`Asset ${assetId} not found on old contract`);
        skipped++;
        continue;
      } else if (e instanceof EthereumTransactionError) {
        if (e.reason.includes("Asset already exists")) {
          skipped++;
          continue;
        }
      } else if (`${e}`.includes("must have admin role to grant")) {
        logger.info(`not an admin to grant roles for ${assetId}`);
        continue;
      }
      throw e;
    }
  }

  if (oldFinp2pAddress) {
    const oldFinP2PContract = new FinP2PContract(provider, signer, oldFinp2pAddress, logger);
    const paymentAssets = await finp2p.getPaymentAssets();
    logger.info(`Got a list of ${paymentAssets.length} assets to migrate`);
    for (const { orgId: assetOrg, assets } of paymentAssets) {
      if (assets.length > 0 && assetOrg === orgId) {
        for (const { code } of assets) {
          let tokenAddress: string;
          try {
            tokenAddress = await oldFinP2PContract.getAssetAddress(code);
          } catch (e) {
            if (!`${e}`.includes("Asset not found")) {
              logger.error(e)
            }
            continue
          }

          logger.info(`Migrating payment asset ${code} with token address ${tokenAddress}`);
          const txHash = await finP2PContract.associateAsset(code, tokenAddress);
          await finP2PContract.waitForCompletion(txHash);
        }
      }
    }
  }

  logger.info("Migration complete");
  logger.info(`Migrated ${migrated} of ${assets.length} assets`);
  logger.info(`Skipped ${skipped} assets`);
};

const orgId = process.env.ORGANIZATION_ID;
if (!orgId) {
  console.error("Env variable ORGANIZATION_ID was not set");
  process.exit(1);
}

const ossUrl = process.env.OSS_URL;
if (!ossUrl) {
  console.error("Env variable OSS_URL was not set");
  process.exit(1);
}

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;

const contractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!contractAddress) {
  console.error("Env variable FINP2P_CONTRACT_ADDRESS was not set");
  process.exit(1);
}

const oldFinp2pAddress = process.env.OLD_FINP2P_CONTRACT_ADDRESS;


const grantOperator = process.env.GRANT_OPERATOR === "yes";
const grantMinter = process.env.GRANT_MINTER === "yes";

startMigration(orgId, ossUrl, providerType, contractAddress, oldFinp2pAddress, grantOperator, grantMinter).then(() => {
}).catch(console.error);
