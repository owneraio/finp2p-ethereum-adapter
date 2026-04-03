import { finIdToAddress, privateKeyToFinId } from '@owneraio/finp2p-contracts';
import {
  AccountMappingService,
  DerivationAccountMapping,
  DbAccountMapping,
} from '../src/services/direct/account-mapping';
import { FIELD_LEDGER_ACCOUNT_ID } from '../src/services/direct/mapping-validator';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { execSync } from 'child_process';
import { join } from 'path';

const TEST_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const TEST_FIN_ID = privateKeyToFinId(TEST_PRIVATE_KEY);
const TEST_ADDRESS = finIdToAddress(TEST_FIN_ID);

const TEST_PRIVATE_KEY_2 = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const TEST_FIN_ID_2 = privateKeyToFinId(TEST_PRIVATE_KEY_2);
const TEST_ADDRESS_2 = finIdToAddress(TEST_FIN_ID_2);

function runSharedTests(name: string, create: () => Promise<{ service: AccountMappingService; teardown?: () => Promise<void> }>) {
  describe(name, () => {
    let service: AccountMappingService;
    let teardown: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      const result = await create();
      service = result.service;
      teardown = result.teardown;
    });

    afterAll(async () => {
      await teardown?.();
    });

    it('should resolve account for a known finId', async () => {
      const account = await service.resolveAccount(TEST_FIN_ID);
      expect(account).toBeDefined();
      expect(account!.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
    });

    it('should resolve finId for a known account', async () => {
      await service.resolveAccount(TEST_FIN_ID);
      const finId = await service.resolveFinId(TEST_ADDRESS);
      expect(finId).toBe(TEST_FIN_ID);
    });

    it('should resolve finId case-insensitively', async () => {
      await service.resolveAccount(TEST_FIN_ID);
      const finId = await service.resolveFinId(TEST_ADDRESS.toUpperCase());
      expect(finId).toBe(TEST_FIN_ID);
    });

    it('should return undefined for unknown finId', async () => {
      const account = await service.resolveAccount('0000000000000000000000000000000000000000000000000000000000000000aa');
      expect(account).toBeUndefined();
    });

    it('should return undefined for unknown account', async () => {
      const finId = await service.resolveFinId('0x0000000000000000000000000000000000000000');
      expect(finId).toBeUndefined();
    });
  });
}

// --- DerivationAccountMapping ---
runSharedTests('DerivationAccountMapping', async () => ({
  service: new DerivationAccountMapping(),
}));

// --- DbAccountMapping ---
describe('DbAccountMapping', () => {
  let container: StartedPostgreSqlContainer;
  let storage: workflows.Storage;
  let service: DbAccountMapping;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const connectionString = container.getConnectionUri();

    // Initialize skeleton Storage (registers Pool in openConnections)
    storage = new workflows.Storage({ connectionString });

    // Run skeleton migrations (includes account_mappings table)
    const gooseBin = join(process.cwd(), 'bin', 'goose');
    const migrationsDir = join(process.cwd(), 'node_modules', '@owneraio', 'finp2p-nodejs-skeleton-adapter', 'migrations');
    execSync(
      `${gooseBin} -table account_mapping_test_migrations -dir ${migrationsDir} up`,
      { env: { ...process.env, GOOSE_DRIVER: 'postgres', GOOSE_DBSTRING: connectionString } }
    );

    service = new DbAccountMapping();
  }, 60000);

  afterAll(async () => {
    await storage.closeConnections();
    await container.stop();
  });

  it('should save and resolve a mapping', async () => {
    await service.saveOwnerMapping(TEST_FIN_ID, { [FIELD_LEDGER_ACCOUNT_ID]: TEST_ADDRESS });
    const account = await service.resolveAccount(TEST_FIN_ID);
    expect(account?.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
  });

  it('should resolve finId from account', async () => {
    const finId = await service.resolveFinId(TEST_ADDRESS);
    expect(finId).toBe(TEST_FIN_ID);
  });

  it('should resolve finId case-insensitively', async () => {
    const finId = await service.resolveFinId(TEST_ADDRESS.toLowerCase());
    expect(finId).toBe(TEST_FIN_ID);
  });

  it('should be idempotent on duplicate insert', async () => {
    await service.saveOwnerMapping(TEST_FIN_ID, { [FIELD_LEDGER_ACCOUNT_ID]: TEST_ADDRESS });
    const account = await service.resolveAccount(TEST_FIN_ID);
    expect(account?.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
  });

  it('should delete a specific field mapping', async () => {
    await service.saveOwnerMapping(TEST_FIN_ID_2, { [FIELD_LEDGER_ACCOUNT_ID]: TEST_ADDRESS_2 });
    await service.deleteOwnerMapping(TEST_FIN_ID_2, FIELD_LEDGER_ACCOUNT_ID);
    const account = await service.resolveAccount(TEST_FIN_ID_2);
    expect(account).toBeUndefined();
  });

  it('should delete all mappings for a finId', async () => {
    await service.saveOwnerMapping(TEST_FIN_ID_2, {
      [FIELD_LEDGER_ACCOUNT_ID]: TEST_ADDRESS_2,
      custodyAccountId: 'vault-99',
    });
    await service.deleteOwnerMapping(TEST_FIN_ID_2);
    const account = await service.resolveAccount(TEST_FIN_ID_2);
    expect(account).toBeUndefined();
  });

  it('should return undefined for unknown finId', async () => {
    const account = await service.resolveAccount('nonexistent');
    expect(account).toBeUndefined();
  });

  it('should return undefined for unknown account', async () => {
    const finId = await service.resolveFinId('0x0000000000000000000000000000000000000000');
    expect(finId).toBeUndefined();
  });

  it('should query by field value', async () => {
    const mappings = await service.getByFieldValue(FIELD_LEDGER_ACCOUNT_ID, TEST_ADDRESS);
    expect(mappings.length).toBeGreaterThan(0);
    expect(mappings[0].finId).toBe(TEST_FIN_ID);
  });
});
