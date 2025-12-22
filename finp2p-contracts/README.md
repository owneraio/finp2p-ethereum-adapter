
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

* **Asset Standard Contracts:** Individual contracts deployed to handle the interaction logic for specific token types (e.g., `ERC20AssetStandard`, `TREXAssetStandard`).
* **Asset Registry:** A dedicated contract acting as a directory, mapping standard names to their corresponding Asset Standard contract addresses.

During execution, the FinP2P contract queries the **Asset Registry** to dynamically resolve the correct standard interface for the target asset.

## State Management
The contract maintains internal state for **Asset Mapping**, functioning as a registry that translates FinP2P Asset IDs into their corresponding on-chain token contract addresses.

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

Before running any of the scripts, make sure to install the dependencies by running `npm install` in the `finp2p-contracts` folder 
and build the sources by running `npm run compile` and `npm run build`.


## Deploy FinP2P operator contract



### Running deploy directly via npx:

FinP2P operator contract could be deployed using npx command:

```
npx -p @owneraio/finp2p-contracts deploy-contract \
    --deployer_pk 0xa11db02ddd62302c8cb4e6f07f058726061e7fa42502cda442a65fb8aaf76ca1 \
    --rpc_url https://ethereum-sepolia-rpc.publicnode.com \
    --operator 0x19B8c9839982669Bd9D46f3a8FC9c1875f23B60D
```

Where:

- `--rpc_url` - Ethereum network url
- `--deployer_pk` - Private key of the account that will deploy the contract
- `--operator` - Address of the operator account
  which would be granted with `OPERATOR` and `TRANSACTION_MANAGER` roles and could be used latter as an OPERATOR_ADDRESS parameter in the adapter configuration.

Version of the package could be specified by adding `@version` after `@owneraio/finp2p-contracts`, e.g. `@owneraio/finp2p-contracts@0.25.0`.


### Running deploy via npm script:


FinP2P operator contract could be deployed using `deploy` script:

Change the folder to `finp2p-contracts` and run:

`npm run deploy-contract -- $ETHEREUM_RPC_URL $PRIVATE_KEY $OPERATOR_ADDRESS`

Where:

- `$ETHEREUM_RPC_URL` - Ethereum network url
- `$PRIVATE_KEY` - Private key of the account that will deploy the contract
- `$OPERATOR_ADDRESS` - Address of the operator account
  which would be granted with `OPERATOR` and `TRANSACTION_MANAGER` roles and could be used latter as an OPERATOR_ADDRESS parameter in the adapter configuration.


## Grant roles FinP2P operator contract

In order to grant roles to the operator account, use `grant-roles` script:

`npm run grant-roles -- $ETHEREUM_RPC_URL $FINP2P_TOKEN_ADDRESS $DEPLOYER_PRIVATE_KEY $OPERATOR_ADDRESS`

Where:

- `$ETHEREUM_RPC_URL` - Ethereum network url
- `$FINP2P_TOKEN_ADDRESS` - FinP2P operator contract address
- `$DEPLOYER_PRIVATE_KEY` - Private key of the account which deployed the contract
- `$OPERATOR_ADDRESS` - Address of the operator account
  which would be granted with `OPERATOR` and `TRANSACTION_MANAGER` roles and could be used latter as an OPERATOR_ADDRESS parameter in the adapter configuration.

#### Associate FinP2P asset with actual token address

In order to associate FinP2P asset with actual token address, use `associate-asset` script:

`npm run associate-asset -- $ETHEREUM_RPC_URL $FINP2P_OPERATOR_ADDRESS $DEPLOYER_PRIVATE_KEY $ASSET_ID $TOKEN_ADDRESS

Where:

- `$ETHEREUM_RPC_URL` - Ethereum network url
- `$FINP2P_OPERATOR_ADDRESS` - FinP2P operator contract address
- `$DEPLOYER_PRIVATE_KEY` - Private key of the account which deployed the contract
- `$ASSET_ID` - FinP2P asset id
- `$TOKEN_ADDRESS` - Actual token address
