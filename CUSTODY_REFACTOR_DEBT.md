# Custody Provider Refactor — Technical Debt

## Active branch: `task/decoupled-custody-signers`

### 1. Old EIP-1193 path still wired in fireblocks-provider.ts
`fireblocks-provider.ts` still uses `createFireblocksEthersProvider` (FireblocksWeb3Provider → BrowserProvider) and `localSubmit` branching with `FireblocksRawSigner`. Should use `createFireblocksCustodyWallet` + `FireblocksCustodySigner` from `signers/`. The master merge overwrote the PR 193 provider with the old `feature/custody-local-submit` version.

**Files:** `src/services/direct/fireblocks-provider.ts`, `src/services/direct/fireblocks-config.ts`

### 2. Dead code: FireblocksRawSigner and LocalSubmitSigner
`src/services/direct/fireblocks-raw-signer.ts` is superseded by `signers/fireblocks-signer.ts`. `local-submit-signer.ts` may also still exist. Both should be removed.

**Files:** `src/services/direct/fireblocks-raw-signer.ts`, `src/services/direct/local-submit-signer.ts`

### 3. FireblocksWeb3Provider dependency still in package.json
`@fireblocks/fireblocks-web3-provider` can be removed once the EIP-1193 path is gone. Removes `ChainId`, `ApiBaseUrl` enums dependency.

### 4. `localSubmit` flag remnants in config
`fireblocks-config.ts` still has `chainId?: ChainId` (optional for localSubmit). Once provider is fixed, `chainId` becomes unnecessary — all signing goes through `FireblocksCustodySigner` (RAW operation), broadcasting through adapter RPC or custody `custodySendTransaction`.

### 5. CustodyRoleBindings not applied on current branch state
The master merge brought back `custodyProvider.issuer/escrow` in `fireblocks-provider.ts`. The `CustodyRoleBindings` extraction we did was overwritten. Needs re-application after provider is fixed.

### 6. `fireblocks-provider.ts` has `createWalletForCustodyId` using old path
Uses `FireblocksRawSigner` or `createFireblocksEthersProvider` depending on `localSubmit`. Should use `createFireblocksCustodyWallet`.

### 7. Hardcoded `ETH_TEST5` asset ID in fireblocks-provider.ts
`resolveAddressFromCustodyId` and `onAssetRegistered` use hardcoded `'ETH_TEST5'`. Should use `config.fireblocksAssetId`.

### 8. Role account IDs are provider-prefixed env vars — should be generic
Issuer/escrow/omnibus/gas account IDs are role bindings, not custody-provider config, but each provider reads its own prefixed env vars:
- `FIREBLOCKS_ASSET_ISSUER_VAULT_ID` / `DFNS_ASSET_ISSUER_WALLET_ID` / `BLOCKDAEMON_ASSET_ISSUER_ACCOUNT_ID`
- `FIREBLOCKS_ASSET_ESCROW_VAULT_ID` / `DFNS_ASSET_ESCROW_WALLET_ID` / `BLOCKDAEMON_ASSET_ESCROW_ACCOUNT_ID`
- `FIREBLOCKS_OMNIBUS_VAULT_ID` / `DFNS_OMNIBUS_WALLET_ID` / `BLOCKDAEMON_OMNIBUS_ACCOUNT_ID`
- `FIREBLOCKS_GAS_FUNDING_VAULT_ID` / `DFNS_GAS_FUNDING_WALLET_ID` / `BLOCKDAEMON_GAS_FUNDING_ACCOUNT_ID`

**Target:** Generic env vars (`CUSTODY_ISSUER_ACCOUNT_ID`, `CUSTODY_ESCROW_ACCOUNT_ID`, `CUSTODY_OMNIBUS_ACCOUNT_ID`, `CUSTODY_GAS_FUNDING_ACCOUNT_ID`, `CUSTODY_GAS_FUNDING_AMOUNT`) read once in a shared config layer. The custody provider receives opaque account ID strings and interprets them internally (vault ID for Fireblocks, wallet ID for DFNS, IV account ID for Blockdaemon).

**Design notes:**
- Aligns with `CustodyRoleBindings<TWallet>` — config-side equivalent of the type-level separation we already have.
- Role config type: `RoleAccountConfig { issuerAccountId: string, escrowAccountId: string, omnibusAccountId?: string, gasFunding?: { accountId: string, amount: string } }`
- Read from env once in shared config, passed to `CustodyProvider.create(providerConfig, roleConfig)`.
- Provider-specific env vars (`FIREBLOCKS_API_KEY`, `DFNS_BASE_URL`, etc.) stay provider-prefixed — those are genuinely provider-specific.
- Backward compat: support old prefixed vars as fallback during migration.
