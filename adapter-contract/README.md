# @owneraio/finp2p-ethereum-adapter-contract

The FinP2P Ethereum adapter's plugin SPI — the single source of truth for what a
token-standard plugin implements: the `TokenStandard` interface, the optional
`InvestorWhitelisting` capability, and the runtime values plugins use
(`successfulTokenOp` / `failedTokenOp`, the `LegType` / `PrimaryType` / `Phase` /
`ReleaseType` enums).

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
