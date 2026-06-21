import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import winston from 'winston';
import { migrationsTableName as vanillaMigrationsTable } from '@owneraio/finp2p-vanilla-service';
import { adoptLegacyMigrationTables } from '../src/legacy-migration';

const LEDGER_SCHEMA = 'test_schema';
const LEGACY_ETH_TABLE = 'finp2p_ethereum_adapater_migrations';
const NEW_ETH_TABLE = `${LEDGER_SCHEMA}_migrations`;
const LEGACY_VANILLA_TABLE = vanillaMigrationsTable;
const NEW_VANILLA_TABLE = `${LEDGER_SCHEMA}_${vanillaMigrationsTable}`;

const silentLogger = winston.createLogger({
  level: 'error',
  transports: [new winston.transports.Console({ silent: true })],
});

async function tableExists(pool: Pool, name: string): Promise<boolean> {
  const { rows } = await pool.query<{ oid: string | null }>(
    `SELECT to_regclass('public.${name}')::text AS oid;`,
  );
  return rows[0]?.oid !== null;
}

async function createGooseLikeTable(pool: Pool, name: string, seed = true): Promise<void> {
  await pool.query(`
    CREATE TABLE public.${name} (
      id BIGSERIAL PRIMARY KEY,
      version_id BIGINT NOT NULL,
      is_applied BOOLEAN NOT NULL,
      tstamp TIMESTAMP DEFAULT NOW()
    );
  `);
  if (seed) {
    await pool.query(`
      INSERT INTO public.${name} (version_id, is_applied) VALUES (0, true), (20240101000000, true);
    `);
  }
}

async function dropAllRenameTables(pool: Pool): Promise<void> {
  for (const t of [LEGACY_ETH_TABLE, NEW_ETH_TABLE, LEGACY_VANILLA_TABLE, NEW_VANILLA_TABLE]) {
    await pool.query(`DROP TABLE IF EXISTS public.${t};`);
  }
}

describe('adoptLegacyMigrationTables', () => {
  let container: StartedPostgreSqlContainer;
  let connectionString: string;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    connectionString = container.getConnectionUri();
    pool = new Pool({ connectionString });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await dropAllRenameTables(pool);
  });

  it('renames the legacy ethereum-adapter table when only the legacy name exists', async () => {
    await createGooseLikeTable(pool, LEGACY_ETH_TABLE);

    await adoptLegacyMigrationTables(connectionString, silentLogger, LEDGER_SCHEMA);

    expect(await tableExists(pool, LEGACY_ETH_TABLE)).toBe(false);
    expect(await tableExists(pool, NEW_ETH_TABLE)).toBe(true);

    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM public.${NEW_ETH_TABLE};`);
    expect(rows[0].n).toBe(2);
  });

  it('renames the vanilla migrations table when only the legacy name exists', async () => {
    await createGooseLikeTable(pool, LEGACY_VANILLA_TABLE);

    await adoptLegacyMigrationTables(connectionString, silentLogger, LEDGER_SCHEMA);

    expect(await tableExists(pool, LEGACY_VANILLA_TABLE)).toBe(false);
    expect(await tableExists(pool, NEW_VANILLA_TABLE)).toBe(true);
  });

  it('renames both tables when both legacy names exist', async () => {
    await createGooseLikeTable(pool, LEGACY_ETH_TABLE);
    await createGooseLikeTable(pool, LEGACY_VANILLA_TABLE);

    await adoptLegacyMigrationTables(connectionString, silentLogger, LEDGER_SCHEMA);

    expect(await tableExists(pool, LEGACY_ETH_TABLE)).toBe(false);
    expect(await tableExists(pool, NEW_ETH_TABLE)).toBe(true);
    expect(await tableExists(pool, LEGACY_VANILLA_TABLE)).toBe(false);
    expect(await tableExists(pool, NEW_VANILLA_TABLE)).toBe(true);
  });

  it('is a no-op on a fresh deployment (no legacy tables)', async () => {
    await adoptLegacyMigrationTables(connectionString, silentLogger, LEDGER_SCHEMA);

    expect(await tableExists(pool, LEGACY_ETH_TABLE)).toBe(false);
    expect(await tableExists(pool, NEW_ETH_TABLE)).toBe(false);
    expect(await tableExists(pool, LEGACY_VANILLA_TABLE)).toBe(false);
    expect(await tableExists(pool, NEW_VANILLA_TABLE)).toBe(false);
  });

  it('skips rename when both legacy and new tables already exist (broken-upgrade state)', async () => {
    await createGooseLikeTable(pool, LEGACY_ETH_TABLE, true);
    await createGooseLikeTable(pool, NEW_ETH_TABLE, false);

    await adoptLegacyMigrationTables(connectionString, silentLogger, LEDGER_SCHEMA);

    // Legacy is preserved (we don't overwrite the new table); operator must reconcile manually.
    expect(await tableExists(pool, LEGACY_ETH_TABLE)).toBe(true);
    expect(await tableExists(pool, NEW_ETH_TABLE)).toBe(true);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM public.${NEW_ETH_TABLE};`);
    expect(rows[0].n).toBe(0);
  });

  it('is idempotent (running twice produces the same result as running once)', async () => {
    await createGooseLikeTable(pool, LEGACY_ETH_TABLE);

    await adoptLegacyMigrationTables(connectionString, silentLogger, LEDGER_SCHEMA);
    await adoptLegacyMigrationTables(connectionString, silentLogger, LEDGER_SCHEMA);

    expect(await tableExists(pool, LEGACY_ETH_TABLE)).toBe(false);
    expect(await tableExists(pool, NEW_ETH_TABLE)).toBe(true);
  });

  it('handles concurrent invocations safely', async () => {
    await createGooseLikeTable(pool, LEGACY_ETH_TABLE);

    await Promise.all([
      adoptLegacyMigrationTables(connectionString, silentLogger, LEDGER_SCHEMA),
      adoptLegacyMigrationTables(connectionString, silentLogger, LEDGER_SCHEMA),
      adoptLegacyMigrationTables(connectionString, silentLogger, LEDGER_SCHEMA),
    ]);

    expect(await tableExists(pool, LEGACY_ETH_TABLE)).toBe(false);
    expect(await tableExists(pool, NEW_ETH_TABLE)).toBe(true);
  });

  it('preserves row contents across rename', async () => {
    await pool.query(`
      CREATE TABLE public.${LEGACY_ETH_TABLE} (
        id BIGSERIAL PRIMARY KEY,
        version_id BIGINT NOT NULL,
        is_applied BOOLEAN NOT NULL,
        tstamp TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      INSERT INTO public.${LEGACY_ETH_TABLE} (version_id, is_applied)
      VALUES (1, true), (2, true), (3, false);
    `);

    await adoptLegacyMigrationTables(connectionString, silentLogger, LEDGER_SCHEMA);

    const { rows } = await pool.query(
      `SELECT version_id, is_applied FROM public.${NEW_ETH_TABLE} ORDER BY version_id;`,
    );
    expect(rows).toEqual([
      { version_id: '1', is_applied: true },
      { version_id: '2', is_applied: true },
      { version_id: '3', is_applied: false },
    ]);
  });
});
