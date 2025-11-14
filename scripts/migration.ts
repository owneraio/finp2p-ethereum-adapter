#!/usr/bin/env node
import winston, { format, transports } from "winston";
import console from "console";
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  FinP2PContract,
  ERC20Contract,
  EthereumTransactionError,
  MINTER_ROLE,
  OPERATOR_ROLE,
  isEthereumAddress,
  ERC20_STANDARD_ID
} from "@owneraio/finp2p-contracts";
import { createJsonProvider, parseConfig } from "../src/config";

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.json()
});


const startMigration = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  orgId: string,
  ossUrl: string,
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

  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);
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
    let tokenStandard: string;
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
      tokenStandard = ERC20_STANDARD_ID;
    }

    try {
      const foundAddress = await finP2PContract.getAssetAddress(assetId);
      if (foundAddress === tokenAddress) {
        logger.info(`Asset ${assetId} already associated with token ${tokenAddress}`);
        // @ts-ignore
        const standardAddress = await finP2PContract.getAssetStandardViaFinP2PContract(finp2pContractAddress, tokenStandard);
        if (grantOperator) {
          const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
          if (!await erc20.hasRole(OPERATOR_ROLE, standardAddress)) {
            await erc20.grantOperatorTo(standardAddress);
            logger.info("       granting new operator [done]");
          } else {
            logger.info(`       operator already granted for ${tokenAddress}`);
          }
        }
        if (grantMinter) {
          const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
          if (!await erc20.hasRole(MINTER_ROLE, standardAddress)) {
            await erc20.grantMinterTo(standardAddress);
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
      let tokenStandard = ERC20_STANDARD_ID;
      // if (identifier) {
      //   const { type, value } = identifier;
      //   if (type === "CUSTOM" && value) {
      //     tokenStandard = keccak256(toUtf8Bytes(value));
      //   }
      // }
      const txHash = await finP2PContract.associateAsset(assetId, tokenAddress, tokenStandard);
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
              logger.error(e);
            }
            continue;
          }
          let tokenStandard = ERC20_STANDARD_ID;

          logger.info(`Migrating payment asset ${code} with token address ${tokenAddress}`);
          const txHash = await finP2PContract.associateAsset(code, tokenAddress, tokenStandard);
          await finP2PContract.waitForCompletion(txHash);
        }
      }
    }
  }

  logger.info("Migration complete");
  logger.info(`Migrated ${migrated} of ${assets.length} assets`);
  logger.info(`Skipped ${skipped} assets`);
};



const config = parseConfig([
  {
    name: "operator_pk",
    envVar: "OPERATOR_PRIVATE_KEY",
    required: true,
    description: "Operator private key"
  },
  {
    name: "rpc_url",
    envVar: "RPC_URL",
    required: true,
    description: "Ethereum RPC URL"
  },
  {
    name: "organization_id",
    envVar: "ORGANIZATION_ID",
    required: true,
    description: "Organization ID"
  },
  {
    name: "oss_url",
    envVar: "OSS_URL",
    required: true,
    description: "OSS URL"
  },
  {
    name: "finp2p_contract_address",
    envVar: "FINP2P_CONTRACT_ADDRESS",
    required: true,
    description: "FINP2P Contract Address"
  },
  {
    name: "old_finp2p_contract_address",
    envVar: "OLD_FINP2P_CONTRACT_ADDRESS",
    description: "Old FINP2P Contract Address"
  },
  {
    name: "grant_operator",
    envVar: "GRANT_OPERATOR",
    description: "Grant operator role to FINP2P contract (yes|no)",
    defaultValue: "no"
  },
  {
    name: "grant_minter",
    envVar: "GRANT_MINTER",
    description: "Grant minter role to FINP2P contract (yes|no)",
    defaultValue: "no"
  }
]);


startMigration(
  config.operator_pk!,
  config.rpc_url!,
  config.organization_id!,
  config.oss_url!,
  config.finp2p_contract_address!,
  config.old_finp2p_contract_address,
  config.grant_operator === "yes",
  config.grant_minter === "yes"
).catch(console.error);
