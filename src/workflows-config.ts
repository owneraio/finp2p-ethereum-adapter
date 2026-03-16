import path from "node:path";
import {
  migrationsDir as vanillaMigrationsDir,
  migrationsTableName as vanillaMigrationsTable,
} from "@owneraio/finp2p-vanilla-service";

export const adapterMigrationsDir = path.join(__dirname, "..", "migrations");
export const adapterMigrationsTable = "finp2p_ethereum_adapter_local_migrations";

export const additionalWorkflowsMigrations = [
  { migrationsDir: vanillaMigrationsDir, tableName: vanillaMigrationsTable },
  { migrationsDir: adapterMigrationsDir, tableName: adapterMigrationsTable },
];
