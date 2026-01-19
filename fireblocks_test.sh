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
REQUEST_BODY='{
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
    "code": "fake_usdc_without_checks"
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

REQUEST_BODY='{
  "asset": {
    "type": "finp2p",
    "resourceId": "FAKEUSDC15"
  },
  "ledgerAssetBinding": {
    "type": "tokenId"
  },
  "denomination": {
    "type": "cryptocurrency",
    "code": "USDC"
  },
  "assetIdentifier": {
    "assetIdentifierType": "ISIN"
  },
  "name": "OWNERA"
}'

until curl --fail --request POST \
     --url "${ENDPOINT}/assets/create" \
     --header 'Idempotency-Key: 14' \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data "$REQUEST_BODY" | jq -e '.isCompleted' > /dev/null; do
  sleep 1
done

REQUEST_BODY='{
  "destination": {
    "type": "finId",
    "finId": "ignoredFinId"
  },
  "asset": {
    "type": "finp2p",
    "resourceId": "FAKEUSDC15"
  },
  "signature": {
    "template": {
      "type": "hashList"
    },
    "hashFunc": "unspecified",
    "signature": "null"
  },
  "nonce": "issue-nonce",
  "quantity": "1.6",
  "settlementRef": "null"
}'

until curl --fail --request POST \
     --url "${ENDPOINT}/assets/issue" \
     --header 'Idempotency-Key: 14' \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data "$REQUEST_BODY" | jq -e '.isCompleted' > /dev/null; do
  sleep 1
done
