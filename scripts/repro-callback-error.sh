#!/usr/bin/env bash
# Reproduces the silent-callback bug we hit in org-c (k3d-local6) on adapter
# image :0.28.1 (skeleton 0.28.5, no result.error logging).
#
# Deploy this branch's image (skeleton 0.28.11, has result.error logging,
# but still has the network='' bug — fix lives on PR #227) and run this
# script against the adapter directly:
#
#   ADAPTER_URL=http://ethereum.org-c-finp2p-local ./scripts/repro-callback-error.sh
#
# Expected adapter log line within seconds:
#   "Callback rejected by router (HTTP error)" cid=… status=400 …
#
# That message is what was *missing* on skeleton 0.28.5 — confirming both
# the schema mismatch and that the upstream logging fix is live.

set -euo pipefail

ADAPTER_URL="${ADAPTER_URL:?set ADAPTER_URL, e.g. http://ethereum.org-c-finp2p-local}"
ASSET_ID="${ASSET_ID:-org-c:102:repro-$(date +%s)}"
ISSUER_ID="${ISSUER_ID:-org-c:101:1fa8c496-cc56-4d14-810d-13da3de5b600}"
TOKEN_ID="${TOKEN_ID:-0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238}"
NETWORK="${NETWORK:-eip155:11155111}"

curl -fsSL -X POST "${ADAPTER_URL}/api/assets/create" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(openssl rand -hex 32)" \
  -d "$(cat <<EOF
{
  "asset": { "resourceId": "${ASSET_ID}" },
  "denomination": { "code": "USD", "type": "fiat" },
  "issuerId": "${ISSUER_ID}",
  "ledgerAssetBinding": {
    "assetIdentifierType": "CAIP-19",
    "network": "${NETWORK}",
    "standard": "erc20",
    "tokenId": "${TOKEN_ID}"
  },
  "metadata": {
    "signatureTemplate": { "hashFunction": "keccak-256", "templateType": "eip712" }
  },
  "name": "USDC"
}
EOF
)"

echo
echo "Watch adapter logs for 'Callback rejected by router (HTTP error)'."
