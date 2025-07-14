
# Contracts

## The FinP2P operator contract
[ FINP2POperator.sol](contracts/finp2p/FINP2POperator.sol) is the FinP2P operator contracts, it implements FinP2P related interfaces such as `IFinP2PAsset` and `IFinP2PEscrow` providing basic functionality for managing FinP2P assets and maintaining escrow operation on them.

Acting as a pivotal link, the FinP2P Operator Contract facilitates the connection between the FinP2P adapter and the underlying token contracts. Upon receiving a FinP2P instruction, the adapter invokes the appropriate methods within the operator contract. It effectively connects FinP2P assets and the actual token addresses, ensures the integrity of signatures and payloads, and relays instructions to the targeted token contract.


### Access control

The FinP2P operator contract employs access control scheme to delineate roles and permissions efficiently.

`ASSET_MANAGER` role is responsible for managing FinP2P assets and their associations with actual token addresses.

`TRANSACTION_MANAGER` role is responsible for sending FinP2P transactions, the operator account should have this role to send transactions on behalf of the adapter.

### Supported token standards

While this implementation of the FinP2P Operator Contract is tailored to the ERC20 token standard, its design is sufficiently adaptable to accommodate any token contracts analogous to the ERC20 framework.

## A sample ERC20 token implementation

[ ERC20WithOperator.sol](./contracts/token/ERC20/ERC20WithOperator.sol) - This project showcases a bespoke ERC20 contract variant, donating the FinP2P operator contract as the default operator. Nonetheless, this contract serves as an example, and any standard ERC20 contract could be employed in its stead.


------------------------------------------------------------------------------------------------------------------------

# Scripts

Before running any of the scripts, make sure to install the dependencies by running `npm install` in the `finp2p-contracts` folder 
and build the sources by running `npm run compile` and `npm run build`.


## Deploy FinP2P operator contract

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
