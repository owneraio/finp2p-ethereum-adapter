import { Pool } from 'pg';
import type { JournalEntry, OrderJournal } from '@owneraio/finp2p-ethereum-wisdomtree-connect';

export class PgIssuerOrderJournal implements OrderJournal {
  constructor(private readonly pool: Pool, private readonly schema: string) {}

  async get(operationId: string): Promise<JournalEntry | undefined> {
    const { rows } = await this.pool.query(
      `SELECT entry FROM ${this.schema}.issuer_order_journal WHERE operation_id = $1`, [operationId]);
    return rows[0]?.entry;
  }

  async put(operationId: string, entry: JournalEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.issuer_order_journal (operation_id, entry) VALUES ($1, $2)
       ON CONFLICT (operation_id) DO UPDATE SET entry = EXCLUDED.entry, updated_at = CURRENT_TIMESTAMP`,
      [operationId, JSON.stringify(entry)]);
  }
}
