import { Pool, PoolClient } from "pg";
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
 * Atomic: all renames run inside a single transaction so a partial failure (transient
 * connection error, lock timeout) leaves the DB unchanged rather than half-migrated.
 * Race-safe across concurrent boots: each rename runs inside its own savepoint, so if
 * another replica completes it between our check and our ALTER, we ROLLBACK TO SAVEPOINT,
 * recognise the post-rename state, and continue with the next rename.
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let savepointIndex = 0;
    for (const { from, to } of renames) {
      await renameLegacyTableInTransaction(client, from, to, savepointIndex++, log);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

async function renameLegacyTableInTransaction(
  client: PoolClient,
  from: string,
  to: string,
  savepointIndex: number,
  log: winston.Logger,
): Promise<void> {
  const sourceExists = await tableExists(client, from);
  const destExists = await tableExists(client, to);

  if (!sourceExists || destExists) {
    log.info({
      from, to, sourceExists, destExists, renamed: false,
      msg: 'adoptLegacyMigrationTables: skipped (source missing or destination exists)',
    });
    return;
  }

  const savepoint = `rename_${savepointIndex}`;
  await client.query(`SAVEPOINT ${savepoint};`);
  try {
    await client.query(`ALTER TABLE public.${from} RENAME TO ${to};`);
    await client.query(`RELEASE SAVEPOINT ${savepoint};`);
    log.info({ from, to, renamed: true, msg: 'adoptLegacyMigrationTables: renamed' });
  } catch (e) {
    // Concurrent boots: another replica may have completed the rename between
    // our check and our ALTER. Roll back this rename's savepoint, re-read catalog;
    // if the post-rename state is now visible, treat as success-by-other-actor and
    // continue with the next rename. Otherwise re-raise so the whole transaction aborts.
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint};`);
    if (!(await tableExists(client, from)) && await tableExists(client, to)) {
      log.info({ from, to, renamed: false, msg: 'adoptLegacyMigrationTables: completed by another actor' });
      return;
    }
    throw e;
  }
}

async function tableExists(client: Pool | PoolClient, name: string): Promise<boolean> {
  const { rows } = await client.query<{ oid: string | null }>(
    `SELECT to_regclass('public.${name}')::text AS oid;`,
  );
  return rows[0]?.oid !== null;
}
