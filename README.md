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

`FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES` lists Permit2Swap contracts from `@owneraio/finp2p-ethereum-permit2-swap`, in the same `0xaddress` or `Name=0xaddress` format. An entry without a name is called `Permit2Swap` (or `Permit2Swap-` and 8 address digits when there are several). Permit2 venues join the same venue list after the allowance venues, but only for custody providers; see below for `finp2p-contract`. The asset lists the Permit2Swap contract address for swap, and the router's chosen contract is matched against it; the Permit2 address itself is never listed. The feature is off unless the variable is set. An address or name used in both lists is rejected at startup.

| Variable | Default | Meaning |
|----------|---------|---------|
| `FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES` | unset (off) | Permit2Swap contract addresses |
| `FINP2P_ETHEREUM_PERMIT2_ADDRESS` | canonical Permit2 | The Permit2 deployment the venues grant allowances through |

Permit2Swap works like AllowanceSwap: the first `swap(operationId, leg)` call records a leg and the counterparty's mirrored call moves both legs through `Permit2.transferFrom` in one transaction. The contract is permissionless, so the operator needs no role on it. Each leg needs a Permit2 allowance from the party to the Permit2Swap contract that covers the amount and has not expired.

In custody modes the wallet signer is the giving party and submits its own leg, since the contract only accepts a party's own leg. The adapter grants the allowance itself: an ERC20 `approve(Permit2)` when the token allowance is short, then `Permit2.approve(token, Permit2Swap, amount, expiration)`, expiring at the swap deadline. The swap deadline is the one on the instruction and becomes the leg's deadline, so both sides derive the same value; the venue's default window applies only when an instruction carries none. A retry of an operation id resumes with the recorded transaction or the prepared leg; a different trade under the same id fails the swap.

The Permit2 venue checks the deadline itself, after it looks up an execution already recorded for the operation. A retry after the deadline of a swap that settled in time therefore still succeeds, and a new submission after the deadline fails. For allowance venues the service rejects an expired swap before calling the venue, because that contract has no deadline and a leg prepared late could still be executed by the counterparty.

In `finp2p-contract` mode the operator relays for the party and cannot grant the Permit2 allowance, so Permit2 venues are ignored there: they are not reported as swap contracts, the router cannot pick them, and the adapter logs a warning naming each one at startup. Custody modes run every venue in the list: a swap that names a contract runs on the venue listed under that address, and a swap that names none runs on the first venue.

In a cross-org swap each organization's adapter submits its own party's leg, so one leg's asset can exist only on the counterparty's adapter. A custody adapter that has no record of a swap leg's asset takes the token address from the leg's ledger identifier and reads `decimals()` from chain. It fails the swap with a clear message when the identifier carries no token address. Only swap does this; issue, transfer, redeem and hold still need a known asset.

## Asset capabilities

Set `ASSET_CAPABILITIES_ENABLED=true` to report which contracts can run each instruction for an asset. It is off by default: the adapter then returns no capability list on asset creation, which the router reads as the full instruction set, and `POST /assets/getCapabilities` answers 501. The `finp2p-contract` provider and the custody providers report capabilities; the omnibus account model does not.

With the flag on, the creation response and `getCapabilities` list the FinP2P operator contract for hold, transfer, release, issue, revert hold and redeem, and every configured allowance swap venue for swap (Permit2 venues are not used in this mode). A contract is listed by address and format only, as `eip155:<chainId>:<checksummed address>` with format `caip10`; it has no name or description. `getCapabilities` answers 404 for an unknown asset.

The router sends the address of the contract it chose in `executionContext.contract`, in the form the asset listed it. The adapter accepts a CAIP-10 id whose namespace is `eip155` (any letter case), whose chain reference is this chain's decimal id, and whose 0x address matches a listed contract in any letter case. It runs the instruction through that contract. Anything else, including a bare 0x address, another chain or another format, is refused with a failed receipt and no transaction. This check applies whether or not the flag is on.

Custody providers run no contract of their own, so their list names the instructions they can run and carries no contracts, except for swap:

| Instruction | Listed when |
|-------------|-------------|
| transfer, redeem | always |
| issue | an issuer wallet is configured (`ASSET_ISSUER_PRIVATE_KEY`) |
| hold, release, revert hold | an escrow wallet is configured (`ASSET_ESCROW_CUSTODY_ACCOUNT_ID`) |
| swap | at least one swap venue is configured; every venue is listed, allowance venues first, as described above |

With the flag off, custody providers report no list and `getCapabilities` answers 501, as before.

When the router names a contract for hold, transfer, release, issue, revert hold or redeem, a custody provider refuses it with a failed receipt and no chain call. For swap it runs the venue listed under that address, matched the same way, and refuses a contract that matches no venue with a failed swap and no chain call. With no contract named, swap runs on the first venue.

## Local custody provider (dev only)

`PROVIDER_TYPE=local` lets the adapter sign for investors itself, so a swap can run from the UI on a local or dev chain with no external signing approval. The keys sit in the adapter's environment, so it is not for production. It refuses to start unless `LOCAL_CUSTODY_DEV_ONLY=true`.

| Variable | Meaning |
|----------|---------|
| `LOCAL_CUSTODY_DEV_ONLY` | Must be `true` to start |
| `LOCAL_CUSTODY_PRIVATE_KEYS` | Comma-separated `0x` private keys, one wallet each |
| `NETWORK_HOST` | The chain RPC the wallets submit to |

The custody account id of a wallet is its address, matched in any letter case. Use it wherever a custody account id is expected, for example `ASSET_ESCROW_CUSTODY_ACCOUNT_ID`, or when binding an investor to a wallet. Each key has one nonce-managed signer, shared with the issuer when it uses the same key. The provider cannot create custody accounts, so deposits that need a new custody address are refused.

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
