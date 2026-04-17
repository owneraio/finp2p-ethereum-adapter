// @ts-ignore — pg types not installed, Pool used structurally
import { Pool } from 'pg';

export interface AssetRow {
  id: string;
  contract_address: string;
  decimals: number;
  token_standard: string;
}

export interface AssetStore {
  getAsset(assetId: string): Promise<AssetRow | undefined>;
  saveAsset(asset: Omit<AssetRow, 'created_at' | 'updated_at'>): Promise<void>;
}

export class PgAssetStore implements AssetStore {
  constructor(private readonly pool: Pool) {}

  async getAsset(assetId: string): Promise<AssetRow | undefined> {
    const { rows } = await this.pool.query(
      'SELECT id, contract_address, decimals, token_standard FROM ledger_adapter.assets WHERE id = $1 LIMIT 1',
      [assetId],
    );
    return rows[0] ?? undefined;
  }

  async saveAsset(asset: Omit<AssetRow, 'created_at' | 'updated_at'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO ledger_adapter.assets (id, contract_address, decimals, token_standard)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET contract_address = $2, decimals = $3, token_standard = $4`,
      [asset.id, asset.contract_address, asset.decimals, asset.token_standard],
    );
  }
}
