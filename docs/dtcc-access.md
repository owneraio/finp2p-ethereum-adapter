# DTCC access

The adapter can reach DTCC's AppChain the way DTCC exposes it: through the DTCC Gateway, with a token from DTCC Identity (IDT) on every call. Set `DTCC_IDT_ISSUER` to turn it on. All `NETWORK_HOST` calls then go through the Gateway, including those from the DTCC plugin and the token standards.

```
 Adapter                                   DTCC
 ┌──────────────────────────┐
 │ DtccAccess               │── service-account login ──►  Identity (IDT)
 │   service-account token  │◄── token (entity, scopes) ──
 │   (cached until expiry)  │
 │                          │
 │ chain calls (NETWORK_HOST)── JSON-RPC + Bearer token ──►  Gateway ──► AppChain (Besu)
 └──────────────────────────┘
```

DTCC has not yet confirmed whether a user login is required on top of the service account. Both models are supported, and `DTCC_AUTH_MODE` selects one.

## `service-account` (default)

The connector's service account alone authorizes calls. This is the machine user DTCC's Tokenization Service documentation describes. No user login and no redirect are involved.

## `delegated`

This is the agreed Direct Connect model: a user logs in at DTCC Identity and delegates to the connector for a window. Until then, every DTCC call fails with "DTCC access needs a user delegation".

```
User      Router UI                 Adapter /dtcc            DTCC Identity
 │ sign in ─►│                            │                        │
 │           │── authorize + PKCE challenge ──────────────────────►│
 │◄────────────────────── login page ─────────────────────────────│
 │── credentials ─────────────────────────────────────────────────►│
 │           │◄────────────────────────────── code (redirect) ────│
 │           │── code + PKCE verifier ────────────────────────────►│
 │           │◄────────────────────────────── user token ─────────│
 │           │                            │                        │
 │           │── POST /dtcc/delegation ──►│ checks the signature,  │
 │           │   Bearer <user token>      │ issuer, audience, the  │
 │           │   { windowSeconds, scopes }│ user's scopes and entity
 │           │◄── delegation until T ─────│                        │
 │           │                            │                        │
 │           │       unattended calls ────│── service-account login (scopes = delegation)
 │           │                            │── Gateway calls + token
```

A delegation never exceeds the user:

- the requested scopes must be among the user's own;
- the user's entity must be the service account's;
- the window is at most `DTCC_DELEGATION_MAX_SECONDS`.

Service-account tokens are requested with the delegation's scopes. Delegations are held in memory, so a restart requires a new login.

| Call | Result |
| --- | --- |
| `POST /dtcc/delegation`, `Authorization: Bearer <IDT user token>`, body `{ "windowSeconds": 3600, "scopes": ["tokenization"] }` | `201 { delegation }`. `401` if the token is invalid, `403` if the scopes or entity exceed the user's, `400` if the window is out of range, `502` if DTCC Identity refuses the service account. |
| `GET /dtcc/delegation` | `{ mode, delegation \| null }` |
| `DELETE /dtcc/delegation` | `204`, revokes the delegation |

Note: in this model the delegation is enforced by the adapter. DTCC sees only the service account. For DTCC itself to see on whose behalf a call is made, IDT would need to support token exchange (RFC 8693).

## Configuration

| Variable | |
| --- | --- |
| `DTCC_IDT_ISSUER` | DTCC Identity issuer URL. Turns DTCC access on. |
| `DTCC_AUTH_MODE` | `service-account` (default) or `delegated` |
| `DTCC_SA_GRANT` | `client_credentials` (default; the solution brief) or `password` (DTCC's documentation: a machine user's username and password) |
| `DTCC_SA_CLIENT_ID` | The service account's OIDC client |
| `DTCC_SA_CLIENT_SECRET` | With `client_credentials` |
| `DTCC_SA_USERNAME`, `DTCC_SA_PASSWORD` | With `password` |
| `DTCC_CHAIN_ID` | The AppChain's chain id. Required in `delegated` mode, so that the adapter starts without reading the chain. |
| `DTCC_USER_AUDIENCE` | Expected audience of user tokens: the Router UI's OIDC client |
| `DTCC_DELEGATION_MAX_SECONDS` | Longest delegation window (default 28800, i.e. 8 hours) |

The entity is read from the `entity` claim and the scopes from `scope`. These claim names are assumptions until DTCC's API reference confirms them.

## Local mock

`npm run dtcc-mock-identity` starts a stand-in for DTCC Identity and the Gateway. It provides:

- OIDC discovery and signing keys;
- a login page for authorization code + PKCE;
- service-account tokens by client credentials or password;
- with `DTCC_MOCK_UPSTREAM_RPC` set, a Gateway at `/gateway/rpc` that rejects calls without a valid token and forwards the rest to that RPC.

Users, service accounts and clients come from `DTCC_MOCK_CONFIG` (a JSON file), or built-in examples. `tests/dtcc-access.test.ts` runs both modes end to end against it.

## Not covered yet

- Mutual TLS to the Gateway.
- Wallet claims (a control-proofed wallet bound to the entity) for GraphQL and wallet-scoped reads.
- The Factory GraphQL (`SUBGRAPH_BASE_URL`) is called by the DTCC plugin itself and does not carry the token yet.
