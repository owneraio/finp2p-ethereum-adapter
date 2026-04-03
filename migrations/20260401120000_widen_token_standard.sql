-- +goose Up
-- +goose StatementBegin
-- Widen token_standard from ENUM('ERC20') to VARCHAR to support plugin-delivered standards.
ALTER TABLE ledger_adapter.assets
  ALTER COLUMN token_standard TYPE VARCHAR(255) USING token_standard::VARCHAR;
DROP TYPE IF EXISTS ledger_adapter.token_standard;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE TYPE ledger_adapter.token_standard AS ENUM('ERC20');
ALTER TABLE ledger_adapter.assets
  ALTER COLUMN token_standard TYPE ledger_adapter.token_standard USING token_standard::ledger_adapter.token_standard;
-- +goose StatementEnd
