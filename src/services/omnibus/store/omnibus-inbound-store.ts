import { AssetType } from "@owneraio/finp2p-adapter-models";
import { Pool } from "pg";
import {
  CreateDepositIntentInput,
  ObservedOmnibusDeposit,
  OmnibusDepositIntent,
  TrackedOmnibusAsset,
} from "./models";

const normalizeAddress = (value: string | undefined): string | undefined =>
  value ? value.toLowerCase() : undefined;

export class OmnibusInboundStore {
  constructor(private readonly pool: Pool) {}

  async createDepositIntent(input: CreateDepositIntentInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO ledger_adapter.omnibus_deposit_intents
        (reference_id, destination_fin_id, destination_account, asset_id, asset_type,
         token_contract_address, token_decimals, expected_amount, expected_amount_units,
         sender_address, details, status, expires_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::numeric, $9::numeric, $10, $11::jsonb, 'pending', $12)`,
      [
        input.referenceId,
        input.destinationFinId,
        JSON.stringify(input.destinationAccount),
        input.assetId,
        input.assetType,
        input.tokenContractAddress.toLowerCase(),
        input.tokenDecimals,
        input.expectedAmount,
        input.expectedAmountUnits,
        normalizeAddress(input.senderAddress),
        JSON.stringify(input.details ?? null),
        input.expiresAt,
      ],
    );
  }

  async expirePendingDepositIntents(): Promise<number> {
    const result = await this.pool.query(
      `UPDATE ledger_adapter.omnibus_deposit_intents
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending' AND expires_at <= NOW()`,
    );
    return result.rowCount ?? 0;
  }

  async listTrackedAssets(): Promise<TrackedOmnibusAsset[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT asset_id, asset_type, token_contract_address, token_decimals
       FROM (
         SELECT asset_id, asset_type, token_contract_address, token_decimals
         FROM ledger_adapter.omnibus_deposit_intents
         WHERE status = 'pending' AND expires_at > NOW()
         UNION
         SELECT asset_id, asset_type, token_contract_address, token_decimals
         FROM ledger_adapter.omnibus_observed_deposits
         WHERE status = 'detected'
       ) tracked
       ORDER BY asset_type, asset_id, token_contract_address`,
    );

    return result.rows.map((row: any) => ({
      assetId: row.asset_id,
      assetType: row.asset_type,
      tokenContractAddress: row.token_contract_address,
      tokenDecimals: row.token_decimals,
    }));
  }

  async listPendingDepositIntents(
    assetId: string,
    assetType: AssetType,
  ): Promise<OmnibusDepositIntent[]> {
    const result = await this.pool.query(
      `SELECT reference_id, destination_fin_id, asset_id, asset_type,
              token_contract_address, token_decimals, expected_amount::text,
              expected_amount_units::text, sender_address, details, status,
              transaction_hash, log_index, expires_at, created_at, updated_at
       FROM ledger_adapter.omnibus_deposit_intents
       WHERE status = 'pending' AND asset_id = $1 AND asset_type = $2 AND expires_at > NOW()
       ORDER BY created_at ASC, reference_id ASC`,
      [assetId, assetType],
    );

    return result.rows.map((row: any) => ({
      referenceId: row.reference_id,
      destinationFinId: row.destination_fin_id,
      assetId: row.asset_id,
      assetType: row.asset_type,
      tokenContractAddress: row.token_contract_address,
      tokenDecimals: row.token_decimals,
      expectedAmount: row.expected_amount,
      expectedAmountUnits: row.expected_amount_units,
      senderAddress: row.sender_address ?? undefined,
      details: row.details ?? undefined,
      status: row.status,
      transactionHash: row.transaction_hash ?? undefined,
      logIndex: row.log_index ?? undefined,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async recordObservedDeposit(input: {
    transactionHash: string;
    logIndex: number;
    blockNumber: number;
    assetId: string;
    assetType: AssetType;
    tokenContractAddress: string;
    tokenDecimals: number;
    senderAddress: string;
    recipientAddress: string;
    amountUnits: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO ledger_adapter.omnibus_observed_deposits
        (transaction_hash, log_index, block_number, asset_id, asset_type, token_contract_address,
         token_decimals, sender_address, recipient_address, amount_units, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, 'detected')
       ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
      [
        input.transactionHash,
        input.logIndex,
        input.blockNumber,
        input.assetId,
        input.assetType,
        input.tokenContractAddress.toLowerCase(),
        input.tokenDecimals,
        input.senderAddress.toLowerCase(),
        input.recipientAddress.toLowerCase(),
        input.amountUnits,
      ],
    );
  }

  async listDetectedDeposits(
    assetId: string,
    assetType: AssetType,
  ): Promise<ObservedOmnibusDeposit[]> {
    const result = await this.pool.query(
      `SELECT transaction_hash, log_index, block_number, asset_id, asset_type,
              token_contract_address, token_decimals, sender_address,
              recipient_address, amount_units::text, status, matched_reference_id,
              failure_reason, created_at, updated_at
       FROM ledger_adapter.omnibus_observed_deposits
       WHERE status = 'detected' AND asset_id = $1 AND asset_type = $2
       ORDER BY block_number ASC, log_index ASC`,
      [assetId, assetType],
    );

    return result.rows.map((row: any) => ({
      transactionHash: row.transaction_hash,
      logIndex: row.log_index,
      blockNumber: row.block_number,
      assetId: row.asset_id,
      assetType: row.asset_type,
      tokenContractAddress: row.token_contract_address,
      tokenDecimals: row.token_decimals,
      senderAddress: row.sender_address,
      recipientAddress: row.recipient_address,
      amountUnits: row.amount_units,
      status: row.status,
      matchedReferenceId: row.matched_reference_id ?? undefined,
      failureReason: row.failure_reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async setObservedDepositFailureReason(
    transactionHash: string,
    logIndex: number,
    failureReason: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ledger_adapter.omnibus_observed_deposits
       SET failure_reason = $3, updated_at = NOW()
       WHERE transaction_hash = $1 AND log_index = $2`,
      [transactionHash, logIndex, failureReason],
    );
  }

  async markObservedDepositFulfilled(
    transactionHash: string,
    logIndex: number,
    referenceId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ledger_adapter.omnibus_observed_deposits
       SET status = 'fulfilled', matched_reference_id = $3, failure_reason = NULL, updated_at = NOW()
       WHERE transaction_hash = $1 AND log_index = $2`,
      [transactionHash, logIndex, referenceId],
    );
  }

  async markDepositIntentFulfilled(
    referenceId: string,
    transactionHash: string,
    logIndex: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ledger_adapter.omnibus_deposit_intents
       SET status = 'fulfilled', transaction_hash = $2, log_index = $3, updated_at = NOW()
       WHERE reference_id = $1`,
      [referenceId, transactionHash, logIndex],
    );
  }

  async getMonitorCursor(key: string): Promise<number | undefined> {
    const result = await this.pool.query(
      `SELECT last_scanned_block
       FROM ledger_adapter.omnibus_monitor_state
       WHERE monitor_key = $1`,
      [key],
    );
    return result.rows[0]?.last_scanned_block;
  }

  async saveMonitorCursor(key: string, lastScannedBlock: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO ledger_adapter.omnibus_monitor_state (monitor_key, last_scanned_block)
       VALUES ($1, $2)
       ON CONFLICT (monitor_key)
       DO UPDATE SET last_scanned_block = EXCLUDED.last_scanned_block, updated_at = NOW()`,
      [key, lastScannedBlock],
    );
  }
}
