#!/usr/bin/env node
import winston, { format, transports } from "winston";
import console from "console";
import { FinP2PClient, LedgerAssetInfo } from "@owneraio/finp2p-client";
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
import { BytesLike, keccak256, Provider, Signer, toUtf8Bytes } from "ethers";
import { Logger } from "@owneraio/finp2p-adapter-models";

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.json()
});

const getTokenInfo = (ledgerAssetInfo: LedgerAssetInfo) : {
  tokenAddress: string,
  standardId: BytesLike
} => {
  const { tokenId, ledgerReference } = ledgerAssetInfo;
  if (ledgerReference) {
    const { address, tokenStandard } = ledgerReference;
    if (tokenStandard === "TokenStandard_ERC20") { // legacy value
      return { tokenAddress: address, standardId: ERC20_STANDARD_ID };
    } else {
      return { tokenAddress: address, standardId: keccak256(toUtf8Bytes(tokenStandard)) };
    }
  } else {
    return {
      tokenAddress: tokenId,
      standardId: ERC20_STANDARD_ID
    }
  }
}

const whiteListBasedOnStandard = async (
  provider: Provider,
  signer: Signer,
  tokenAddress: string,
  logger: Logger,
  standardId: BytesLike,
  operator: string
) => {
  if (standardId === ERC20_STANDARD_ID) {
    await whitelistERC20(provider, signer, tokenAddress, logger, operator);
  } else {
    logger.info(`Token standard ${standardId} is not supported for whitelisting`);
  }
};

const whitelistERC20 = async (
  provider: Provider,
  signer: Signer,
  tokenAddress: string,
  logger: Logger,
  operator: string
) => {
  logger.info(`Token standard is ERC20 with operator, checking roles`);
  const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
  if (!await erc20.hasRole(OPERATOR_ROLE, operator)) {
    await erc20.grantOperatorTo(operator);
    logger.info("       granting new operator [done]");
  } else {
    logger.info(`       operator already granted for ${tokenAddress}`);
  }
  if (!await erc20.hasRole(MINTER_ROLE, operator)) {
    await erc20.grantMinterTo(operator);
    logger.info("       granting new minter [done]");
  } else {
    logger.info(`       minter already granted for ${tokenAddress}`);
  }
};


const startMigration = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  orgId: string,
  ossUrl: string,
  finp2pContractAddress: string,
  oldFinp2pAddress: string | undefined) => {
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
    const { tokenAddress, standardId } = getTokenInfo(ledgerAssetInfo);
    if (!isEthereumAddress(tokenAddress)) {
      continue
    }
    const standardAddress = await finP2PContract.getAssetStandardViaFinP2PContract(finp2pContractAddress, standardId);

    try {
      const foundAddress = await finP2PContract.getAssetAddress(assetId);
      if (foundAddress === tokenAddress) {
        logger.info(`Asset ${assetId} already associated with token ${tokenAddress}`);
        await whiteListBasedOnStandard(provider, signer, tokenAddress, logger, standardId, standardAddress);
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
      await finP2PContract.associateAsset(assetId, tokenAddress, standardId);
      logger.info("       asset association [done]");
      await whiteListBasedOnStandard(provider, signer, tokenAddress, logger, standardId, standardAddress);
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
          await finP2PContract.associateAsset(code, tokenAddress, tokenStandard);
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
  }
]);


startMigration(
  config.operator_pk!,
  config.rpc_url!,
  config.organization_id!,
  config.oss_url!,
  config.finp2p_contract_address!,
  config.old_finp2p_contract_address
).catch(console.error);
