#!/bin/bash
# Call the hold endpoint on the adapter pod and time the response.
# Usage: bash scripts/test-hold-endpoint.sh

ADAPTER_HOST="ethereum.org-c-finp2p-local:8080"
FIN_ID="0254ef201cfd43545d3071f1f36cb83025dae9c6ddb3db639580cff38106dfaff7"
ASSET_ID="org-c:102:ef6d69fc-3712-41c9-8023-114da656bd1d"
IDEMPOTENCY_KEY="test-hold-timing-$(date +%s)"

PAYLOAD=$(cat <<EOF
{
  "nonce": "test-nonce-$(date +%s)",
  "source": {
    "finId": "${FIN_ID}",
    "account": {"type": "finId", "finId": "${FIN_ID}"}
  },
  "asset": {
    "resourceId": "${ASSET_ID}",
    "type": "finp2p"
  },
  "quantity": "1",
  "operationId": "test-op-$(date +%s)",
  "signature": {
    "signature": "0x0000",
    "template": {
      "type": "EIP712",
      "primaryType": "Transfer",
      "message": {
        "nonce": "test",
        "buyer": {"idkey": "${FIN_ID}"},
        "seller": {"idkey": "${FIN_ID}"},
        "asset": {"assetId": "${ASSET_ID}", "assetType": "finp2p", "amount": "1"}
      }
    }
  }
}
EOF
)

echo "=== Hold Endpoint Timing Test ==="
echo "Adapter: ${ADAPTER_HOST}"
echo "FinId: ${FIN_ID:0:20}..."
echo "Asset: ${ASSET_ID}"
echo ""

echo "Calling POST /api/assets/hold..."
START=$(date +%s%N)

kubectl --context k3d-local6 run --rm -i --restart=Never --image=curlimages/curl:latest hold-test-$(date +%s) -- \
  curl -s -w "\n\nHTTP_CODE=%{http_code}\nTIME_TOTAL=%{time_total}s\n" \
  -X POST "http://${ADAPTER_HOST}/api/assets/hold" \
  -H "Content-Type: application/json" \
  -H "idempotency-key: ${IDEMPOTENCY_KEY}" \
  -d "${PAYLOAD}"

END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))
echo ""
echo "Wall clock: ${ELAPSED}ms"
