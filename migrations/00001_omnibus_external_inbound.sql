-- +goose Up
CREATE TABLE IF NOT EXISTS ledger_adapter.omnibus_deposit_intents (
  reference_id UUID PRIMARY KEY,
  destination_fin_id VARCHAR(255) NOT NULL,
  destination_account JSONB NOT NULL,
  asset_id VARCHAR(255) NOT NULL,
  asset_type VARCHAR(64) NOT NULL,
  token_contract_address VARCHAR(255) NOT NULL,
  token_decimals INTEGER NOT NULL,
  expected_amount NUMERIC NOT NULL,
  expected_amount_units NUMERIC NOT NULL,
  sender_address VARCHAR(255),
  details JSONB,
  status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'fulfilled', 'expired')),
  transaction_hash VARCHAR(255),
  log_index INTEGER,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS omnibus_deposit_intents_pending_idx
  ON ledger_adapter.omnibus_deposit_intents (status, asset_id, asset_type, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS omnibus_deposit_intents_tx_log_idx
  ON ledger_adapter.omnibus_deposit_intents (transaction_hash, log_index)
  WHERE transaction_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger_adapter.omnibus_observed_deposits (
  transaction_hash VARCHAR(255) NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  asset_id VARCHAR(255) NOT NULL,
  asset_type VARCHAR(64) NOT NULL,
  token_contract_address VARCHAR(255) NOT NULL,
  token_decimals INTEGER NOT NULL,
  sender_address VARCHAR(255) NOT NULL,
  recipient_address VARCHAR(255) NOT NULL,
  amount_units NUMERIC NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('detected', 'fulfilled')),
  matched_reference_id UUID,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS omnibus_observed_deposits_status_idx
  ON ledger_adapter.omnibus_observed_deposits (status, asset_id, asset_type, block_number);

CREATE TABLE IF NOT EXISTS ledger_adapter.omnibus_monitor_state (
  monitor_key VARCHAR(255) PRIMARY KEY,
  last_scanned_block BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- +goose Down
DROP TABLE IF EXISTS ledger_adapter.omnibus_monitor_state;
DROP TABLE IF EXISTS ledger_adapter.omnibus_observed_deposits;
DROP TABLE IF EXISTS ledger_adapter.omnibus_deposit_intents;
