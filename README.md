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

¹ Signers default to `OPERATOR_PRIVATE_KEY`; override per role with `ASSET_ISSUER_PRIVATE_KEY` / `ASSET_CONTROLLER_PRIVATE_KEY`. Standards whose constructors accept a whitelisting signer receive `ASSET_WHITELIST_PRIVATE_KEY` (TREX, CMTAT, HEDERA_ATS). Optional-argument semantics are each plugin's contract. Without an issuer/controller key the standards register with an ephemeral signer — reads and whitelist checks work; on-chain agent writes need a configured, authorized key. Skipped entirely only when `NETWORK_HOST` is unset.

## Swap venues

Swap is enabled by configuring one or more allowance swap venues. `FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES` takes a comma-separated list, the first entry is the default, and the singular `FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS` still works (ignored when the plural is set).

Each entry is `0xaddress` or `Name=0xaddress`, for example `AllowanceSwapA=0x8A79...C318,AllowanceSwapB=0xA51c...91C0`. The name is how the venue is listed in the asset's capabilities and must match `^[A-Za-z0-9._-]{1,64}$`. A duplicate name or address (any letter case) is rejected at startup. A swap needs both assets to list the venue under the same name and address, so give a venue the same name on every adapter.

An entry without a name is called `AllowanceSwap` when it is the only venue (this includes the singular variable). Otherwise it is called `AllowanceSwap-` followed by the first 8 hex digits of its address in lower case, so adapters configured with the same addresses derive the same names whatever the order.

### Permit2 venues

`FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES` lists `Permit2Swap` contracts in the same `0xaddress` or `Name=0xaddress` format; an unnamed entry is called `Permit2Swap` (or `Permit2Swap-` plus 8 hex digits when there are several). `FINP2P_ETHEREUM_PERMIT2_ADDRESS` is the Permit2 contract the venues pull through and defaults to the canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3`.

Allowance venues are listed first, then Permit2 venues. Names and addresses must be unique across both lists. A Permit2 venue is listed, and picked, by its `Permit2Swap` contract address; Permit2 itself is the venue's funds-entry point. The adapter only relays `executeSwap`: each party approves Permit2 once per token and submits a signed Permit2 allowance for the contract before the swap. Whichever side calls first settles both legs and the other side resumes from the `SwapExecuted` event.

On a local chain, `node ./node_modules/@owneraio/finp2p-ethereum-permit2-swap/dist/scripts/deploy-local.js` (env `RPC_URL`, `DEPLOYER_PRIVATE_KEY`) installs Permit2 at the canonical address and deploys `Permit2Swap` at the deployer's nonce 0, skipping what already exists.

The adapter reports its capabilities to the router: the FinP2P operator contract for hold, transfer, release, issue, revert hold and redeem, and every configured venue for swap, each under its name. When the router picks one of the listed contracts (it sends the contract address) for an instruction, the adapter runs it through that contract and refuses a contract it did not list. Custody modes keep a single venue and report no capability list.

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
