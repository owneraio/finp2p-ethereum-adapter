#!/usr/bin/env zsh

set -exuo pipefail

export PORT=3000
export FINP2P_CONTRACT_ADDRESS="0x43007AE643F4beee64ED54032678AF8d0f332f08"
export PROVIDER_TYPE="fireblocks"
export ORGANIZATION_ID="bank-us"
export FINP2P_ADDRESS="http://localhost:8081"
export OSS_URL="http://localhost:8000"
export DB_CONNECTION_STRING="postgres://test:test@localhost:5432/test"
export MIGRATION_CONNECTION_STRING="${DB_CONNECTION_STRING}"
export LEDGER_USER="test"
export LOG_LEVEL="debug"

export FIREBLOCKS_VAULT_ACCOUNT_IDS="0"
export FIREBLOCKS_CHAIN_ID="11155111"
export FIREBLOCKS_API_BASE_URL="https://sandbox-api.fireblocks.io"

npx ts-node src/index.ts &
SERVER_PID=$!

function cleanup() {
  kill "${SERVER_PID}"
}

trap cleanup EXIT

curl --fail --retry 30 --retry-all-errors http://localhost:${PORT}/health
curl --fail --retry 30 --retry-all-errors http://localhost:${PORT}/health/readiness

ENDPOINT="http://localhost:${PORT}/api"

curl --fail --request POST \
     --url "${ENDPOINT}/assets/transfer" \
     --header 'Idempotency-Key: 1' \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data '{
  "source": {
    "account": {
      "type": "finId",
      "finId": "123"
    },
    "finId": "12"
  },
  "destination": {
    "account": {
      "type": "finId",
      "finId": "123"
    },
    "finId": "123"
  },
  "asset": {
    "type": "cryptocurrency",
    "code": "234"
  },
  "signature": {
    "template": {
      "type": "hashList",
      "hash": "1"
    },
    "hashFunc": "keccak_256",
    "signature": "1"
  },
  "quantity": "1",
  "nonce": "123",
  "settlementRef": "1"
}'
