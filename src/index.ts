import * as process from "process";
import { logger, workflows } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import winston, { format, transports } from "winston";
import { Pool } from "pg";
import { migrationsDir as vanillaMigrationsDir, migrationsTableName as vanillaMigrationsTable } from "@owneraio/finp2p-vanilla-service";
import { envVarsToAppConfig } from "./config";
import createApp from "./app";
import { redactSecrets } from "./redact-secrets";

// Pre-#265 the goose tracking tables were hardcoded (`finp2p_ethereum_adapater_migrations`
// with a typo + vanilla's `finp2p_vanilla_service_migrations`) and lived in `public`.
// #265 derives them per-adapter from ledgerSchema so co-deployed adapters stop colliding.
// On upgrade we claim the legacy tables for this binary so migration history isn't lost
// and goose doesn't re-run the schema-creating initial migration.
// Identifiers are pre-validated (toPostgresIdentifier / hardcoded literals) → safe to splice.
async function adoptLegacyMigrationTables(
  connectionString: string,
  log: winston.Logger,
  ledgerSchema: string,
): Promise<void> {
  const renames: Array<{ from: string; to: string }> = [
    { from: 'finp2p_ethereum_adapater_migrations', to: `${ledgerSchema}_migrations` },
    { from: vanillaMigrationsTable, to: `${ledgerSchema}_${vanillaMigrationsTable}` },
  ];
  const pool = new Pool({ connectionString });
  try {
    for (const { from, to } of renames) {
      if (from === to) continue;
      await pool.query(`
        DO $$
        BEGIN
          IF to_regclass('public.${from}') IS NOT NULL
             AND to_regclass('public.${to}') IS NULL THEN
            ALTER TABLE public.${from} RENAME TO ${to};
          END IF;
        END $$;
      `);
      log.info({ from, to, msg: 'legacy migration table rename checked' });
    }
  } finally {
    await pool.end();
  }
}

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

  const finP2PUrl = process.env.FINP2P_ADDRESS;
  const ossUrl = process.env.OSS_URL;
  const finP2PClient = finP2PUrl && ossUrl ? new FinP2PClient(finP2PUrl, ossUrl) : undefined;
  const ledgerSchema = process.env.LEDGER_SCHEMA || workflows.toPostgresIdentifier(process.env.ADAPTER_ID || 'ethereum_adapter')

  const workflowsConfig = {
    migration: {
      connectionString: migrationConnectionString,
      gooseExecutablePath: "/usr/bin/goose",
      migrationListTableName: `${ledgerSchema}_migrations`,
      storageUser,
      schemaName: ledgerSchema,
      additionalMigrations: [
        { migrationsDir: vanillaMigrationsDir, tableName: `${ledgerSchema}_${vanillaMigrationsTable}` },
      ],
    },
    storage: { connectionString: dbConnectionString },
    finP2PClient,
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
      format.json(),
      redactSecrets()
    ),
  });

  await adoptLegacyMigrationTables(migrationConnectionString, logger, ledgerSchema);

  (await createApp(
    workflowsConfig,
    logger,
    await envVarsToAppConfig(logger),
    dbConnectionString,
  )).listen(port, () => {
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
