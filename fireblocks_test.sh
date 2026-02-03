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
export FIREBLOCKS_GAS_FUNDING_VAULT_ID=15
export FIREBLOCKS_GAS_FUNDING_ASSET_ID='ETH_TEST5'
export FIREBLOCKS_GAS_FUNDING_ASSET_AMOUNT='0.01'
export FIREBLOCKS_ASSET_ESCROW_VAULT_ID=16
export FIREBLOCKS_ASSET_ISSUER_VAULT_ID=17

npx ts-node src/index.ts &
SERVER_PID=$!

function cleanup() {
  kill "${SERVER_PID}"
}

trap cleanup EXIT

curl --fail --retry 30 --retry-all-errors http://localhost:${PORT}/health
curl --fail --retry 30 --retry-all-errors http://localhost:${PORT}/health/readiness

ENDPOINT="http://localhost:${PORT}/api"

TOKEN_NAME=`openssl rand -hex 3`
TOKEN_NAME='11a260'
ASSET_RESOURCE_ID=`openssl rand -hex 10`
ASSET_RESOURCE_ID='81a6a38558ed0c5b910f'
ISSUE_DESTINATION_FINID="023909c4944fbfdf8c4bc3331d02c0773f04b6483e5da1d61e8e217b5b249c7951"
TRANSFER_DESTINATION_FINID="03928a764dc1b2c3d3eb48683a4046f4f8cfc6f95a22b6ef3ff9ae400d92c02dbf"
IDEMPOTENCY_HEADER="Idempotency-Key: `openssl rand -hex 12`"
IDEMPOTENCY_HEADER='Idempotency-Key: fqb6sx6brU4nnfuh'

REQUEST_BODY=`jq -n --arg ASSET_RESOURCE_ID "$ASSET_RESOURCE_ID" --arg TOKEN_NAME "$TOKEN_NAME" '{
  "asset": {
    "type": "finp2p",
    "resourceId": $ASSET_RESOURCE_ID
  },
  "denomination": {
    "type": "cryptocurrency",
    "code": "USDC"
  },
  "assetIdentifier": {
    "assetIdentifierType": "CUSTOM",
    "assetIdentifierValue": $TOKEN_NAME
  },
  "name": "OWNERA"
}'`


until curl --fail --request POST \
     --url "${ENDPOINT}/assets/create" \
     --header "$IDEMPOTENCY_HEADER" \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data "$REQUEST_BODY" | jq -e '.isCompleted' > /dev/null; do
  sleep 1
done

REQUEST_BODY=`jq -n --arg ASSET_RESOURCE_ID "$ASSET_RESOURCE_ID" --arg ISSUE_DESTINATION_FINID "$ISSUE_DESTINATION_FINID" '{
  "destination": {
    "type": "finId",
    "finId": $ISSUE_DESTINATION_FINID
  },
  "asset": {
    "type": "finp2p",
    "resourceId": $ASSET_RESOURCE_ID
  },
  "signature": {
    "template": {
      "type": "hashList"
    },
    "hashFunc": "unspecified",
    "signature": "null"
  },
  "nonce": "issue-nonce",
  "quantity": "1",
  "settlementRef": "null"
}'`

until curl --fail --request POST \
     --url "${ENDPOINT}/assets/issue" \
     --header "$IDEMPOTENCY_HEADER" \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data "$REQUEST_BODY" | jq -e '.isCompleted' > /dev/null; do
  sleep 1
done

REQUEST_BODY=`jq -n --arg ASSET_RESOURCE_ID "$ASSET_RESOURCE_ID" --arg ISSUE_DESTINATION_FINID "$ISSUE_DESTINATION_FINID" --arg TRANSFER_DESTINATION_FINID "$TRANSFER_DESTINATION_FINID" '{
  "source": {
    "account": {
      "type": "finId",
      "finId": $ISSUE_DESTINATION_FINID
    },
    "finId": $ISSUE_DESTINATION_FINID
  },
  "destination": {
    "account": {
      "type": "finId",
      "finId": $TRANSFER_DESTINATION_FINID
    },
    "finId": $TRANSFER_DESTINATION_FINID
  },
  "asset": {
    "type": "finp2p",
    "resourceId": $ASSET_RESOURCE_ID
  },
  "signature": {
    "template": {
      "type": "hashList"
    },
    "hashFunc": "unspecified",
    "signature": "signature"
  },
  "nonce": "nonce",
  "quantity": "0.5",
  "settlementRef": "settlement"
}'`

until curl --fail --request POST \
     --url "${ENDPOINT}/assets/transfer" \
     --header "$IDEMPOTENCY_HEADER" \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data "$REQUEST_BODY" | jq -e '.isCompleted' > /dev/null; do
  sleep 1
done
