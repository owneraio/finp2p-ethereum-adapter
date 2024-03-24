
# Contracts

FinP2P operator contract could be found in `./contracts/token/ERC20/FINP2POperatorERC20.sol`.
It implements FinP2P related interfaces such as `IFinP2PAsset` and `IFinP2PEscrow` providing basic functionality for 
managing FinP2P assets and maintaining escrow operation on them.

FinP2P operator contract is in a middle of communication between FinP2P adapter and actual token contract.
After a FinP2P instruction is received from the adapter, the operator contract methods being called. 
FinP2P operator contract performs mapping between FinP2P assets and actual token addresses, then does signature and payload verification 
and forwards the instruction to the actual token contract.


### Access control

FinP2P operator contract utilizes the access control pattern to manage roles and permissions.

`ASSET_MANAGER` role is responsible for managing FinP2P assets and their associations with actual token addresses.

`TRANSACTION_MANAGER` role is responsible for managing FinP2P transactions, the operator account should have this role to perform transactions on behalf of the adapter.

### Supported token standards

The current FinP2P operator contract implementation is based on the ERC20 token standard, 
yet FinP2P operator contract is generic enough to be used with any token contracts similar to ERC20 standard. 

As it is not the user himself who calls ERC20, but the FinP2P contract from the operator’s account, 
ERC20 requires that allowance be set in order to make transfers on behalf of the investor.

The example in this project presents a modified version of the ERC20 contract, which does not require allowance if the caller has operator rights in this contract.
However, any other ERC20 contract can be used instead of this one.



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
