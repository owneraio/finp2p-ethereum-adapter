import * as process from "process";
import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import winston, { format, transports } from "winston";
import { FinP2PContract } from "@owneraio/finp2p-contracts";
import { ProviderType, createProviderAndSigner } from "./config";
import createApp from "./app";
import { InMemoryExecDetailsStore } from "./services";

const init = async () => {
  const port = process.env.PORT || "3000";
  const finP2PContractAddress =
    process.env.FINP2P_CONTRACT_ADDRESS || process.env.TOKEN_ADDRESS; // TOKEN_ADDRESS for backward compatibility
  if (!finP2PContractAddress) {
    throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
  }
  const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;

  const orgId = process.env.ORGANIZATION_ID;
  if (!orgId) {
    throw new Error("ORGANIZATION_ID is not set");
  }
  const finP2PUrl = process.env.FINP2P_ADDRESS;
  if (!finP2PUrl) {
    throw new Error("FINP2P_ADDRESS is not set");
  }
  const ossUrl = process.env.OSS_URL;
  if (!ossUrl) {
    throw new Error("OSS_URL is not set");
  }

  const migrationConnectionString = process.env.MIGRATION_CONNECTION_STRING;
  if (!migrationConnectionString) {
    throw new Error("MIGRATION_CONNECTION_STRING is not set");
  }

  const dbConnectionString = process.env.DB_CONNECTION_STRING;
  if (!dbConnectionString) {
    throw new Error("DB_CONNECTION_STRING is not set");
  }

  const storageUser = process.env.LEDGER_USER;
  if (!storageUser) {
    throw new Error("LEDGER_USER is not set");
  }

  const workflowsConfig = {
    migration: {
      connectionString: migrationConnectionString,
      gooseExecutablePath: "/usr/bin/goose",
      migrationListTableName: "finp2p_ethereum_adapater_migrations",
      storageUser,
    },
    storage: { connectionString: dbConnectionString },
  };

  const level = process.env.LOG_LEVEL || "info";
  const logger = winston.createLogger({
    level,
    transports: [new transports.Console()],
    format: format.combine(
      format.timestamp(),
      format(function dynamicContent(info) {
        if (info.timestamp) {
          info.time = info.timestamp;
          delete info.timestamp;
        }
        if (info.message) {
          info.msg = info.message;
          // @ts-ignore
          delete info.message;
        }
        return info;
      })(),
      format.json()
    ),
  });

  const useNonceManager = process.env.NONCE_POLICY === "fast";
  const { provider, signer } = await createProviderAndSigner(
    providerType,
    useNonceManager
  );
  const finp2pContract = new FinP2PContract(
    provider,
    signer,
    finP2PContractAddress,
    logger
  );
  const finP2PClient = new FinP2PClient(finP2PUrl, ossUrl);
  const execDetailsStore = new InMemoryExecDetailsStore();

  const contractVersion = await finp2pContract.getVersion();
  logger.info(`FinP2P contract version: ${contractVersion}`);
  const { name, version, chainId, verifyingContract } =
    await finp2pContract.eip712Domain();
  logger.info(
    `EIP712 domain: name=${name} version=${version} chainId=${chainId} verifyingContract=${verifyingContract}`
  );

  createApp(
    orgId,
    finp2pContract,
    finP2PClient,
    execDetailsStore,
    workflowsConfig,
    logger
  ).listen(port, () => {
    logger.info(`listening at http://localhost:${port}`);
  });
};

init()
  .then(() => {
    logger.info("Server started successfully");
  })
  .catch((err) => {
    logger.error("Error starting server", err);
    process.exit(1);
  });
