# Implementing a custody provider

A custody provider is the adapter's bridge to a wallet-custody backend
(Fireblocks, DFNS, Blockdaemon Builder Vault, …). Its whole job is to turn the
identifiers the adapter works with — EVM addresses and provider-internal
custody account ids — into ethers `{ provider, signer }` pairs that can sign
and broadcast transactions, without the adapter ever holding a private key.

```ts
export interface CustodyWallet {
  provider: Provider;
  signer: Signer;
}

export interface CustodyProvider {
  resolveWallet(account: string): Promise<CustodyWallet | undefined>;
  createWalletForCustodyId?(custodyAccountId: string): Promise<CustodyWallet>;
  resolveAddressFromCustodyId?(custodyAccountId: string): Promise<string>;
  onAssetRegistered?(tokenAddress: string, symbol?: string): Promise<void>;
  createCustodyAccount?(label?: string): Promise<{ custodyAccountId: string; address: string }>;
  archiveCustodyAccount?(custodyAccountId: string): Promise<void>;
}
```

## The contract, method by method

Only `resolveWallet` is required by the type — but what a deployment can do is
decided by which optional methods exist. Every optional method is
capability-probed (`custodyProvider.createWalletForCustodyId?.(…)` or an
explicit `if`), never assumed.

| Method | Required? | Who calls it | Without it |
|---|---|---|---|
| `resolveWallet(address)` | **yes** | `CustodyTokenService.resolveSourceWallet` — the fallback signer lookup for transfer/hold/redeem when the account mapping carries no custody id | signing works only for mappings that stored a custody id |
| `createWalletForCustodyId(id)` | practically yes | boot wiring in `app.ts`: the escrow wallet (`ASSET_ESCROW_CUSTODY_ACCOUNT_ID`), the gas station (`GAS_FUNDING_CUSTODY_ACCOUNT_ID`), the omnibus wallet (`OMNIBUS_CUSTODY_ACCOUNT_ID`); the per-operation fast path in `resolveSourceWallet`; the deposits `walletResolver` | none of the id-configured wallets can be fabricated — direct mode cannot boot (no escrow wallet), omnibus mode cannot boot, no gas station, no deposits |
| `resolveAddressFromCustodyId(id)` | for custody-id flows | `CustodyMappingValidator` (the `/mapping/owners` enrichment) and `CustodyNetworkAccountService` (custodial-account onboarding binds) | mappings and onboarding accept plain addresses only; the `custodyAccountId` field is not advertised by `GET /mapping/fields` |
| `createCustodyAccount(label?)` | only for OTA deposits | the `ota-deposit` plugin fabricates an ephemeral account per deposit | the OTA deposit method is not registered (the plugin checks and skips) |
| `archiveCustodyAccount(id)` | only for OTA deposits | `ota-deposit` retires the ephemeral account after the sweep | swept accounts accumulate in the workspace |
| `onAssetRegistered(token)` | **skip it** | nobody — the call sites are disabled pending a purpose-specific capability (see the `TODO(custody-registration)` in `CustodyTokenService.createAsset`) | nothing |

Minimal viable provider: `resolveWallet` + `createWalletForCustodyId` +
`resolveAddressFromCustodyId`. Add the account lifecycle pair only if the
deployment needs one-time-address deposits. Do not implement
`onAssetRegistered`.

## The two signing models

A `CustodyWallet.signer` must be a real ethers v6 `Signer` whose
`getAddress()` answers and whose `sendTransaction()` signs remotely and
broadcasts (directly or through the backend). `signTransaction` /
`signMessage` / `signTypedData` may throw `UnsupportedOperation` if the
backend cannot do detached signing — the adapter's flows go through
`sendTransaction`.

1. **SDK-provided ethers integration** — wrap what the vendor ships.
   Fireblocks (default mode) builds a `fireblocks-web3-provider` scoped to
   `vaultAccountIds: [id]`; DFNS wraps `DfnsWallet.init({walletId})` from
   `@dfns/lib-ethersjs6` and connects it to a `JsonRpcProvider`.
2. **Custom remote signer** — subclass `AbstractSigner` and implement
   `getAddress` + `sendTransaction` against the backend's signing API.
   Fireblocks' `LOCAL_SUBMIT=true` mode does this (`FireblocksRawSigner`: raw
   hash signed by the vault, transaction assembled and broadcast locally);
   the Blockdaemon PR's `iv-signer` does the same against Builder Vault
   (submit intent, poll for the tx hash).

Either way the transaction may confirm before `sendTransaction` returns or
long after — callers poll balances/receipts themselves, so do not block on
finality inside the signer.

## Case studies

**Fireblocks** (`src/integrations/custody/fireblocks/`) — custody id = vault
account id. `resolveAddressFromCustodyId` reads the vault's deposit address
for `FIREBLOCKS_ASSET_ID`; `resolveWallet` reverse-resolves address → vault id
through a cached workspace scan (`src/vaults.ts`) — expensive, which is why
the account mapping stores the custody id to skip it. Two signing modes
switched by `LOCAL_SUBMIT`. Implements the full interface including the OTA
account lifecycle.

**DFNS** (`src/integrations/custody/dfns/`) — custody id = wallet id. Loads
the full address → walletId map once in `create()` (kept current when
`createCustodyAccount` adds wallets), so `resolveWallet` is a map lookup. No
deletion API — `archiveCustodyAccount` tags the wallet instead. The cleanest
template to copy.

**Blockdaemon Builder Vault** (PR #186, open) — custody id = Builder Vault
account id, custom `Signer` over the vault's intent API. Written before the
custody registry existed: it lives under the old `services/direct/` layout and
patches `app.ts`/`config.ts` by hand. To land it needs mechanical rebasing
onto this guide's structure — move to `src/integrations/custody/blockdaemon/`,
export `registerBlockdaemon()`, hook it into `registerCustodyIntegrations()`,
and add a `PROVIDER_TYPE=blockdaemon` config case; the provider logic itself
already fits the contract (`resolveWallet`, `resolveAddressFromCustodyId`,
a create factory).

## Step by step

1. **Folder**: `src/integrations/custody/<name>/` with `config.ts`,
   `provider.ts`, `index.ts`.
2. **Config** (`config.ts`): a `<Name>AppConfig` interface and a
   `create<Name>AppConfig()` that reads env vars into named variables and
   fails fast on missing required ones. Wire a `case '<name>'` into
   `src/config.ts`'s provider-type switch.
3. **Provider** (`provider.ts`): `class <Name>CustodyProvider implements
   CustodyProvider` with a `static async create(config)` factory — do
   backend discovery (client construction, wallet listing) there, keep the
   constructor private. Throw plain `Error`s with the backend's reason;
   `resolveWallet` returns `undefined` for unknown addresses, it does not
   throw.
4. **Registration** (`index.ts`):
   ```ts
   export function register<Name>(): void {
     custodyRegistry.register('<name>', (config) => <Name>CustodyProvider.create(config as <Name>AppConfig));
   }
   ```
   and call it from `registerCustodyIntegrations()` in
   `src/integrations/registry.ts`. Activation is config-driven:
   `PROVIDER_TYPE=<name>` selects the factory at boot; nothing about the
   provider runs otherwise.
5. **Conformance**: run the shared suite (below) against an env-gated
   integration test, and add the provider's construction to the mocked
   registry tests if it has boot-time discovery worth pinning.

## Provider-level tests

`tests/utils/custody-provider-conformance.ts` exports `custodyProviderConformance`,
a describe-block factory that asserts the parts of the contract every
implementation must honor, skipping optional methods the provider does not
declare:

- `resolveWallet` of an unknown address resolves to `undefined` (never throws);
- a wallet fabricated by `createWalletForCustodyId(id)` signs as the same
  address `resolveAddressFromCustodyId(id)` reports;
- `resolveWallet` of a known address returns a wallet signing as that address;
- an account from `createCustodyAccount` resolves both ways, and
  `archiveCustodyAccount` accepts it.

CI runs the suite against an in-memory reference provider
(`tests/custody-provider.test.ts`), which also pins the registry semantics
(config-driven activation, duplicate registration, unknown types). A new
provider gets a real-backend run by instantiating the same suite behind its
credentials env vars, the way the Fireblocks deposit tests gate on
`SEPOLIA_RPC_URL`.
