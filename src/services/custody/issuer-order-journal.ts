import { Pool } from 'pg';

export type IssuerOrderRecord = { state: string; request: string; createStartedAt: number };

export interface IssuerOrderJournal {
  get<R extends IssuerOrderRecord>(operationId: string): Promise<R | undefined>;
  create<R extends IssuerOrderRecord>(operationId: string, record: R): Promise<{ record: R; created: boolean }>;
  transition<R extends IssuerOrderRecord>(operationId: string, from: R['state'], to: R): Promise<boolean>;
  claimBurn(burnId: string, operationId: string): Promise<string>;
}

export class PgIssuerOrderJournal implements IssuerOrderJournal {
  constructor(private readonly pool: Pool, private readonly schema: string) {}

  async get<R extends IssuerOrderRecord>(operationId: string): Promise<R | undefined> {
    const { rows } = await this.pool.query(
      `SELECT entry FROM ${this.schema}.issuer_order_journal WHERE operation_id = $1`, [operationId]);
    return rows[0]?.entry;
  }

  async create<R extends IssuerOrderRecord>(operationId: string, record: R): Promise<{ record: R; created: boolean }> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO ${this.schema}.issuer_order_journal (operation_id, entry) VALUES ($1, $2) ON CONFLICT (operation_id) DO NOTHING`,
      [operationId, JSON.stringify(record)]);
    if (rowCount === 1) return { record, created: true };
    const existing = await this.get<R>(operationId);
    if (!existing) throw new Error(`issuer order journal: entry ${operationId} neither inserted nor found`);
    return { record: existing, created: false };
  }

  async transition<R extends IssuerOrderRecord>(operationId: string, from: R['state'], to: R): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.schema}.issuer_order_journal SET entry = $2, updated_at = CURRENT_TIMESTAMP
       WHERE operation_id = $1 AND entry->>'state' = $3 AND entry->>'request' = $4`,
      [operationId, JSON.stringify(to), from, to.request]);
    return rowCount === 1;
  }

  async claimBurn(burnId: string, operationId: string): Promise<string> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.issuer_burn_claim (burn_id, operation_id) VALUES ($1, $2) ON CONFLICT (burn_id) DO NOTHING`,
      [burnId, operationId]);
    const { rows } = await this.pool.query(
      `SELECT operation_id FROM ${this.schema}.issuer_burn_claim WHERE burn_id = $1`, [burnId]);
    return rows[0].operation_id;
  }
}
