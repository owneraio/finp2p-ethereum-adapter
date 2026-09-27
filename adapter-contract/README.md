# @owneraio/finp2p-ethereum-adapter-contract

The FinP2P Ethereum adapter's plugin SPI — the single source of truth for what a
token-standard plugin implements: the `TokenStandard` interface, the optional
`InvestorWhitelisting` capability, and the runtime values plugins use
(`successfulTokenOp` / `failedTokenOp`, the `LegType` / `PrimaryType` / `Phase` /
`ReleaseType` enums, the `signsMessages` guard).

## Ledgers beyond EVM

`TokenStandard<W = TokenWallet>` is parameterised by what a write is
authorised with. Every EVM plugin implements `TokenStandard` with no type
argument, exactly as before. A plugin for a ledger whose transactions are
signed bytes (Stellar, Solana) implements `TokenStandard<MessageSigner>`; the
ethers `provider` / `signer` on `decimals` and `balanceOf` are the configured
chain's and such a plugin ignores them, reaching its ledger through the
transport it was constructed with. One instance serves one ledger, the way the
EVM plugins already take their provider at construction.

`AssetRecord.ledger` is the CAIP-2 id of the ledger the record lives on;
absent means the host's configured chain. The host registry keys on
`(ledger, standard)`, so a record without a ledger resolves as it always has.

`InvestorWhitelisting<W>` takes the party's own wallet as an optional last
argument to `whitelist` / `dewhitelist`, for admissions the party signs itself
(a Stellar trustline). A standard that admits with its own agent keys ignores
it; one that needs it and is not given it fails with a reason.

Owned and released from the adapter repository by its own tag pipeline
(`adapter-contract-v*`), like `finp2p-contracts/`. Versioning: the
major.minor line is shared with the platform (`0.28.x`); the patch version is
independent of the adapter's — the same policy every package in this
ecosystem follows. The adapter consumes it via a registry pin; plugins
declare it as a peerDependency (plus devDependency for local builds). Nobody
depends on the adapter package itself.

The peer expresses which contract a plugin implements — it cannot constrain the
adapter version. Runtime compatibility across versions rests on structural
typing; a structurally incompatible SPI change must ship as a plugin version
outside old adapters' semver ranges.

This package must stay tiny and free of adapter runtime imports (only `ethers`
types). See issue #325 for the architectural decision record.
