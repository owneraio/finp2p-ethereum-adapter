# Configuration API

An adapter-internal API that describes what the adapter needs to be configured, and takes the values. A UI can render a configuration form from the metadata alone: which fields, how they are grouped, which are secret, and which checks run when.

Run it on its own with `npm run config-server`. It listens on `CONFIG_PORT` (default 3100) under `/config` and keeps values in memory. The router (`createConfigRouter`) can be mounted on the adapter's own express app the same way.

## Metadata: `GET /config/schema`

The schema is a list of **groups**, and each group is a list of **fields**. Each field corresponds to one environment variable the adapter reads today (`env`).

```jsonc
{
  "id": "network.rpcUrl", "env": "NETWORK_HOST", "label": "RPC URL", "type": "url",
  "classification": "confidential",           // public | confidential | secret
  "treatment": "stored",                      // stored | sealed (write-only, returned as a fingerprint)
  "required": { "field": "ledger.provider", "in": ["finp2p-contract", "fireblocks", "dfns"] },
  "format": { "pattern": "^https?://\\S+$", "message": "Expected a URL …" },
  "validation": { "ref": "network.rpcUrl", "scope": "field", "path": "/config/validate",
                  "inputs": ["network.rpcUrl", "network.auth"], "description": "Calls eth_chainId …" }
}
```

Field properties:

- **`classification`.** `secret` fields are sealed: they can be written but never read back.
- **`required`** and **`when`.** Either `true`/`false` or a condition on other fields:
  - `{ field }`: the field is set;
  - `{ field, equals }` or `{ field, in }`: its value matches;
  - `{ all: [...] }`: every condition holds;
  - `{ not }`: the condition does not hold.

  This replaces "optional, but…" rules that a template could not express. For example, `NETWORK_HOST` is required for the operator key, Fireblocks and DFNS, and optional for Taurus.
- **`format`.** A regular expression the UI can check as the user types. The server checks it again on write.
- **`validation`.** A live, read-only check, which can belong to a field or to a group. It runs through the generic endpoint at `path` with its `ref`. `inputs` lists the fields it reads, so a UI knows when it can run, e.g. after a group is filled.

Groups have `when` (when they apply), `critical`, and an optional group-level `validation`.

## Values

| Call | Body | Result |
| --- | --- | --- |
| `GET /config/values` | | Current values, with sealed ones as `{ sealed, fingerprint }`. Also: per group which fields apply and are required, each check's last result and whether it is stale, the applied version, and `problems`, the list of what blocks an apply. |
| `PUT /config/values` | `{ "values": { "<fieldId>": "<value>" \| null } }` | All updates are saved, or none. `422` returns `{ fields: { id: message } }` for unknown fields, bad formats and values outside the options. `null` clears a field. |
| `POST /config/validate` | `{ "field": "<id>" }` or `{ "group": "<id>" }` | Runs that check on the current values and returns `{ status: valid \| invalid, message, details[] }`. `409` means the check doesn't apply, or required inputs are missing (listed in `missing`). `404` means no such check. |
| `POST /config/apply` | | Activates the values as a new version. `409` returns `problems`: a missing required field, or a check that is unvalidated, invalid, or stale. |

A check result is tied to the values it ran on. Changing any of its inputs makes it **stale**, and an apply needs it run again.

## Checks

The checks are read-only calls with the clients the adapter already uses:

| Ref | Checks |
| --- | --- |
| `network.rpcUrl` | `eth_chainId` on the RPC, with basic auth when set |
| `contract` | code at `FINP2P_CONTRACT_ADDRESS` on that chain; the operator address and balance from the key |
| `fireblocks` | lists one vault account with the API key and private key |
| `dfns` | lists one wallet with the service account token; the credential key is checked for format only |
| `taurus` | the chain PROTECT reports for the blockchain and network; when an RPC is also set, that both are the same chain |

Messages never include a sealed value.

## Not yet

- **Secret storage.** Secrets are kept in an in-memory `SecretVault`. A KMS-backed vault plugs in behind the same interface.
- **Boot from applied config.** The adapter does not boot from the applied configuration yet. `ConfigStore.appliedEnvironment()` returns it as the environment variables `envVarsToAppConfig` reads, as a first bridge.
- **Escrow and gas account checks.** These need an active custody provider and come next.
