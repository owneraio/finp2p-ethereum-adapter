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

Swap is enabled by configuring one or more allowance swap venues. `FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS` configures a single venue. `FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES` takes a comma-separated list instead, the first entry is the default, and the singular variable is ignored when the plural one is set.

Each entry is `0xaddress` or `Name=0xaddress`, for example `AllowanceSwapA=0x8A79...C318,AllowanceSwapB=0xA51c...91C0`. The name is only used in logs and must match `^[A-Za-z0-9._-]{1,64}$`; the router identifies a venue by its address. A duplicate name or address (any letter case) is rejected at startup.

An entry without a name is called `AllowanceSwap` when it is the only venue (this includes the singular variable). Otherwise it is called `AllowanceSwap-` followed by the first 8 hex digits of its address in lower case, so adapters configured with the same addresses derive the same names in their logs whatever the order.

### Permit2 swap venues

`FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES` lists Permit2Swap contracts from `@owneraio/finp2p-ethereum-permit2-swap`, in the same `0xaddress` or `Name=0xaddress` format. An entry without a name is called `Permit2Swap` (or `Permit2Swap-` and 8 address digits when there are several). Permit2 venues join the same venue list after the allowance venues, are reported for swap and matched by contract address in the same way. The feature is off unless the variable is set. An address or name used in both lists is rejected at startup.

| Variable | Default | Meaning |
|----------|---------|---------|
| `FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES` | unset (off) | Permit2Swap contract addresses |
| `FINP2P_ETHEREUM_PERMIT2_ADDRESS` | canonical Permit2 | The Permit2 deployment each contract must be bound to; a mismatch fails the swap before sending |
| `FINP2P_ETHEREUM_PERMIT2_DEADLINE_SECONDS` | `900` | Deadline window used when a swap carries no deadline |

The operator account must hold `EXECUTOR_ROLE` on every Permit2Swap contract. The adapter checks this before each swap and fails it with a clear reason, without sending, when the role is missing. The swap deadline is the one on the instruction; without one the adapter uses now plus the window above and logs it. A swap past its deadline fails without sending.

When the adapter holds the investor's wallet (custody), it approves Permit2 for the token and sets the Permit2 allowance for the Permit2Swap contract itself with `Permit2.approve`, expiring at the swap deadline, then waits for the counterparty's allowance. Otherwise investors approve Permit2 and set that allowance outside the adapter. A retry of an executed operation id resumes with the recorded transaction when the executed legs match the instruction; a different trade under the same id fails the swap.

## Asset capabilities

Set `ASSET_CAPABILITIES_ENABLED=true` to report which contracts can run each instruction for an asset. It is off by default: the adapter then returns no capability list on asset creation, which the router reads as the full instruction set, and `POST /assets/getCapabilities` answers 501. Only the `finp2p-contract` provider reports capabilities.

With the flag on, the creation response and `getCapabilities` list the FinP2P operator contract for hold, transfer, release, issue, revert hold and redeem, and every configured swap venue for swap. A contract is listed by address and format only, as `eip155:<chainId>:<checksummed address>` with format `caip10`; it has no name or description. `getCapabilities` answers 404 for an unknown asset.

The router sends the address of the contract it chose in `executionContext.contract`, in the form the asset listed it. The adapter accepts a CAIP-10 id whose namespace is `eip155` (any letter case), whose chain reference is this chain's decimal id, and whose 0x address matches a listed contract in any letter case. It runs the instruction through that contract. Anything else, including a bare 0x address, another chain or another format, is refused with a failed receipt and no transaction. This check applies whether or not the flag is on.

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
