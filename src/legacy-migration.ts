import { Pool } from "pg";
import winston from "winston";
import { migrationsTableName as vanillaMigrationsTable } from "@owneraio/finp2p-vanilla-service";

/**
 * Pre-#265 the goose tracking tables were hardcoded (`finp2p_ethereum_adapater_migrations`
 * with a typo + vanilla's `finp2p_vanilla_service_migrations`) and lived in `public`.
 * #265 derives them per-adapter from ledgerSchema so co-deployed adapters stop colliding.
 * On upgrade we claim the legacy tables for this binary so migration history isn't lost
 * and goose doesn't re-run the schema-creating initial migration.
 *
 * Identifiers come from hardcoded literals, validated derivations
 * (workflows.toPostgresIdentifier), or operator-supplied env (LEDGER_SCHEMA) — all trusted.
 *
 * Idempotent: source missing or destination already present → no-op. Race-safe across
 * concurrent boots: ALTER TABLE takes ACCESS EXCLUSIVE; a losing replica re-reads catalog
 * and sees the rename completed.
 */
export async function adoptLegacyMigrationTables(
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
      await renameLegacyTable(pool, from, to, log);
    }
  } finally {
    await pool.end();
  }
}

async function renameLegacyTable(
  pool: Pool,
  from: string,
  to: string,
  log: winston.Logger,
): Promise<void> {
  const sourceExists = await tableExists(pool, from);
  const destExists = await tableExists(pool, to);

  if (!sourceExists || destExists) {
    log.info({
      from, to, sourceExists, destExists, renamed: false,
      msg: 'adoptLegacyMigrationTables: skipped (source missing or destination exists)',
    });
    return;
  }

  try {
    await pool.query(`ALTER TABLE public.${from} RENAME TO ${to};`);
    log.info({ from, to, renamed: true, msg: 'adoptLegacyMigrationTables: renamed' });
  } catch (e) {
    // Concurrent boots: another replica may have completed the rename between
    // our check and our ALTER. Re-read catalog; if dest now exists, treat as success.
    if (!(await tableExists(pool, from)) && await tableExists(pool, to)) {
      log.info({ from, to, renamed: false, msg: 'adoptLegacyMigrationTables: completed by another actor' });
      return;
    }
    throw e;
  }
}

async function tableExists(pool: Pool, name: string): Promise<boolean> {
  const { rows } = await pool.query<{ oid: string | null }>(
    `SELECT to_regclass('public.${name}')::text AS oid;`,
  );
  return rows[0]?.oid !== null;
}
