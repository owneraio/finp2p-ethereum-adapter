import { Pool } from 'pg';

export interface IssuerOrderJournal {
  get<E extends object>(operationId: string): Promise<E | undefined>;
  put<E extends object>(operationId: string, entry: E): Promise<void>;
}

export class PgIssuerOrderJournal implements IssuerOrderJournal {
  constructor(private readonly pool: Pool, private readonly schema: string) {}

  async get<E extends object>(operationId: string): Promise<E | undefined> {
    const { rows } = await this.pool.query(
      `SELECT entry FROM ${this.schema}.issuer_order_journal WHERE operation_id = $1`, [operationId]);
    return rows[0]?.entry;
  }

  async put<E extends object>(operationId: string, entry: E): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.issuer_order_journal (operation_id, entry) VALUES ($1, $2)
       ON CONFLICT (operation_id) DO UPDATE SET entry = EXCLUDED.entry, updated_at = CURRENT_TIMESTAMP`,
      [operationId, JSON.stringify(entry)]);
  }
}
