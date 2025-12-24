
## Overview
The **FinP2P Contract** is the on-chain execution layer. It holds the business logic, executes state changes, and is the destination for calls made by the Ethereum Adapter.

## Core Capabilities
The contract solves four specific execution challenges:

1.  **Protocol Translation:** Converts abstract instructions passed by the adapter into low-level, atomic on-chain token transfers.
2.  **Delegation of Intent:** Verifies investor signatures directly on-chain. This allows investors to pre-authorize business operations (e.g., "Swap $1000 for 10 tokens") without manually executing the blockchain transaction.
3.  **Gas Abstraction (Gas Station):** Uses a central operator wallet to execute transactions. This removes the requirement for investors to hold ETH or pay for gas fees.
4.  **Sequence Enforcement:** Mirrors the off-chain execution plan on-chain to strictly enforce the order of operations and immutably record the execution state.

## State Management
The contract maintains internal state for **Asset Mapping**, functioning as a registry that translates FinP2P Asset IDs into their corresponding on-chain token contract addresses.

## Token Abstraction & Standards
To decouple the core FinP2P contract from specific token implementations (such as ERC20, ERC721, or T-REX), the architecture employs an **Asset Standard** abstraction layer.

* **Asset Standard Contracts:** Individual contracts deployed to handle the interaction logic for specific token types (e.g., `ERC20Standard`, `ERC721Standard`).
* **Asset Registry:** A dedicated contract acting as a directory, mapping standard names to their corresponding Asset Standard contract addresses.

During execution, the FinP2P contract queries the **Asset Registry** to dynamically resolve the correct standard interface for the target asset.

## Access Control & Roles
The contract utilizes a Role-Based Access Control (RBAC) model to restrict operations.

| Role | Responsibility | Key Actions |
| :--- | :--- | :--- |
| **Deployer** | **Initialization** | Deploys the contract; retains ownership; appoints the initial Admin. |
| **Admin** | **Governance** | Manages permissions; grants or revokes Asset Manager and Transaction Manager roles. |
| **Asset Manager** | **Configuration** | Manages the asset registry; registers new tokens or updates existing asset parameters. |
| **Transaction Manager** | **Operations** | Authorized to trigger logic and execute actual token transactions. |

## Immutability & Upgrade Lifecycle
The FinP2P contract is **immutable by design**. Logic cannot be changed on an existing deployment; updates require deploying a completely new contract instance.

### Upgrade Workflow
1.  **Deploy New Instance:** Deploy the new contract version. Verify the version using the `getVersion()` method.
2.  **Migrate Data:** Use the suite's migration utilities to transfer the Asset Association Table and critical state from the old contract (or OSS) to the new instance.
3.  **Update Whitelists (CRITICAL):**
    * **Context:** A new deployment results in a new contract address.
    * **Action Required:** You must **re-whitelist** the new FinP2P contract address on all underlying permissioned tokens (Assets). Failure to do so will cause transactions to fail.




------------------------------------------------------------------------------------------------------------------------

# Scripts

## Prerequisites
Before running any scripts, install dependencies and compile the contract sources:

```bash
npm install
npm run compile
npm run build
```

## 1. Deploy FinP2P Contract

You can deploy the contract using either the published NPM package (npx) or the local source code (`npm run`).

Option A: Deploy via NPX (Remote Package)
Use this method to deploy specific versions of the package without cloning the repository.

### 1. Deploy FinP2P Contract
You can deploy the contract using either the published NPM package (npx) or the local source code (npm run).

Option A: Deploy via NPX (Remote Package)
Use this method to deploy specific versions of the package without cloning the repository.

```bash
npx -p @owneraio/finp2p-contracts deploy-contract \
    --deployer_pk <DEPLOYER_PRIVATE_KEY> \
    --rpc_url <ETHEREUM_RPC_URL> \
    --operator <OPERATOR_ADDRESS>
```

Parameters:

`--rpc_url`: The Ethereum network RPC URL (e.g., Infura, Alchemy, or public node).

`--deployer_pk`: Private key of the account deploying the contract (Gas Payer).

`--operator`: Address of the operator account.

Note: This address is automatically granted `OPERATOR` and `TRANSACTION_MANAGER` roles.

Usage: Use this address as the `OPERATOR_ADDRESS` parameter in the Adapter configuration.

Tip: To deploy a specific version, append the version tag: `@owneraio/finp2p-contracts@0.25.0`

### Option B: Deploy via NPM (Local Source)
Use this method when working directly within the `finp2p-contracts` repository.

```bash
npm run deploy-contract -- $ETHEREUM_RPC_URL $PRIVATE_KEY $OPERATOR_ADDRESS
```
Positional Arguments:

`$ETHEREUM_RPC_URL`: The Ethereum network RPC URL.

`$PRIVATE_KEY`: Private key of the deployer account.

`$OPERATOR_ADDRESS`: Address of the operator account (receives OPERATOR & TRANSACTION_MANAGER roles).

----------------------------------------------------------

## 2. Management & Configuration

### Grant Roles
Use this script to manually grant OPERATOR and TRANSACTION_MANAGER roles to a specific address on an existing contract.

```bash
npm run grant-roles -- $ETHEREUM_RPC_URL $FINP2P_CONTRACT_ADDRESS $DEPLOYER_PRIVATE_KEY $OPERATOR_ADDRESS
```
Positional Arguments:

`$ETHEREUM_RPC_URL`: The Ethereum network RPC URL.

`$FINP2P_CONTRACT_ADDRESS`: The address of the deployed FinP2P Contract.

`$DEPLOYER_PRIVATE_KEY`: Private key of the contract admin/deployer.

`$OPERATOR_ADDRESS`: The account address to receive the roles.

### Associate Assets
Use this script to map a FinP2P Asset ID to an actual on-chain token address (ERC20/ERC721/etc).

```bash
npm run associate-asset -- $ETHEREUM_RPC_URL $FINP2P_CONTRACT_ADDRESS $DEPLOYER_PRIVATE_KEY $ASSET_ID $TOKEN_ADDRESS
```
Positional Arguments:

`$ETHEREUM_RPC_URL`: The Ethereum network RPC URL.

`$FINP2P_CONTRACT_ADDRESS`: The address of the deployed FinP2P Contract.

`$DEPLOYER_PRIVATE_KEY`: Private key of the contract admin/deployer.

`$ASSET_ID`: The unique Asset ID used within the FinP2P network.

`$TOKEN_ADDRESS`: The actual smart contract address of the token on Ethereum.
