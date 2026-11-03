© 2025 XCap Ecosystem Ltd trading as Ownera®. All rights reserved. SPDX-License-Identifier: Apache-2.0

# FinP2P Ethereum Reference Adapter

The FinP2P Ethereum adapter is a reference implementation of a FinP2P adapter to EVM compatiable ledgers. It allows to execute FinP2P instructions to trade tokenized assets on the Ethereum network.
The Adapter communicated with a FinP2P proxy contract on Ethereum network which is responsible to verify and execute the asset movements on chain.

## Supported token standards

The base `TokenStandard` interface is owned by the adapter and published as [`@owneraio/finp2p-ethereum-adapter-contract`](./adapter-contract) (#325); each standard below implements it and is resolved by name from the asset's `token_standard`:

| Standard | Package | Registration |
| :--- | :--- | :--- |
| `ERC20` (default) | built-in (`src/services/direct/token-standards`) | always |
| `TREX` (ERC-3643) | `@owneraio/finp2p-ethereum-trex-plugin` | always¹ |
| `CMTAT` | `@owneraio/finp2p-ethereum-cmtat-plugin` | always¹ |
| `BENJI` | `@owneraio/finp2p-ethereum-benji-plugin` | always¹ |
| `HEDERA_ATS` | `@owneraio/finp2p-ethereum-hedera-plugin` | always¹ |
| `OWNERA_COLLATERAL_REGISTRY` | `@owneraio/finp2p-ethereum-collateral` | `COLLATERAL_REGISTRY_ADDRESS` + `COLLATERAL_AGENT_PRIVATE_KEY` |
| `DTCC_COLLATERAL_ACCOUNT` | `@owneraio/finp2p-ethereum-dtcc-plugin` | `DTCC_PLUGIN_ENABLED=true` |
| `WISDOMTREE` | `@owneraio/finp2p-ethereum-wisdomtree-connect` | `WISDOMTREE_CONNECT_BASE_URL` + credentials² |

¹ Signers default to `OPERATOR_PRIVATE_KEY`; override per role with `ASSET_ISSUER_PRIVATE_KEY` / `ASSET_CONTROLLER_PRIVATE_KEY`. Standards whose constructors accept a whitelisting signer receive `ASSET_WHITELIST_PRIVATE_KEY` (TREX, CMTAT, HEDERA_ATS). Optional-argument semantics are each plugin's contract. Without an issuer/controller key the standards register with an ephemeral signer — reads and whitelist checks work; on-chain agent writes need a configured, authorized key. Skipped entirely only when `NETWORK_HOST` is unset.

² `WISDOMTREE` is a hybrid standard. Transfer, hold, release and balance are plain ERC20. Issue is a WisdomTree Connect **Purchase**, and redeem a Connect **Sale**, which WisdomTree's admin burns from the holder (or from the escrow, for a held redemption). No issuer key is used: the adapter asks the standard under the operation's idempotency key until the order ends, and its journal (`issuer_order_journal`) resumes the same order after a restart. With `WISDOMTREE_WAIT_SECONDS` unset, the standard waits through the order's cutoff delivery before answering. With it set, each call returns after that many seconds, and an order with no final answer after 96 hours fails the operation and is left for manual handling. Held redemptions need escrow holds (the standard's default hold model). Settings:
- `WISDOMTREE_CONNECT_BASE_URL`, `WISDOMTREE_CONNECT_CLIENT_ID`, `WISDOMTREE_CONNECT_CLIENT_SECRET`, `WISDOMTREE_CONNECT_USERNAME`, `WISDOMTREE_CONNECT_PASSWORD`;
- `WISDOMTREE_PRODUCTS`: JSON from token address to `{ exchangeCode, blockchain, settlementCurrency, orderType? }`, e.g. `{"0x0b2517eef907389F36fd87Add36E9118d364BD67":{"exchangeCode":"WTGXX","blockchain":"Ethereum Sepolia","settlementCurrency":"USD"}}`;
- optional `WISDOMTREE_ORGANIZATION_GUID`, `WISDOMTREE_WAIT_SECONDS` and `WISDOMTREE_POLL_INTERVAL_MS`.

It needs `NETWORK_HOST`, because a redeem's receipt is the burn, found in chain logs.

## Documentation

- [Design choices](specs/design.md)
- [Contract details and scripts](./finp2p-contracts/README.md)

### Getting started


#### Install dependencies


`npm clean-install`

#### Compile contracts and generate typescript bindings

The contracts project is located in ./finp2p-contract folder and has its own dependencies to be installed. 

`cd finp2p-contracts && npm install && npm run compile`

#### Run contracts tests

`cd finp2p-contracts && npm run test`

#### Run adapter tests

By default, test environment starts Hardhat node within test-containers and adapter server and run tests against it.

`npm test`

#### External ethereum network

To run tests against external network, set `network.rpcUrl` parameter in `jest.config.js` to the desired network url.


To run tests against external adapter, set `adapter.url` parameter in `jest.config.js` to the desired adapter url.


#### Run migration scripts

After deploying new FinP2P contract the old data should be migrated to the new contract. The migration script could be run using npx command:

```
npx -p @owneraio/finp2p-ethereum-adapter migration \
    --operator_pk 0xa11db02ddd62302c8cb4e6f07f058726061e7fa42502cda442a65fb8aaf76ca1 \
    --rpc_url https://ethereum-sepolia-rpc.publicnode.com \
    --organization_id bank-us \
    --oss_url http://localhost:9000 \
    --finp2p_contract_address 0x8464135c8F25Da09e49BC8782676a84730C318bD

```
