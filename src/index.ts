import * as process from "process";
import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import winston, { format, transports } from "winston";
import { FinP2PContract } from "@owneraio/finp2p-contracts";
import { envVarsToAppConfig } from "./config";
import createApp from "./app";
import { InMemoryExecDetailsStore } from "./services";

const init = async () => {
  const port = process.env.PORT || "3000";

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

  createApp(
    workflowsConfig,
    logger,
    await envVarsToAppConfig(logger)
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
