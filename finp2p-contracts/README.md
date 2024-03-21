
# Scripts

Before running any of the scripts, make sure to install the dependencies by running `npm install` in the `finp2p-contracts` folder 
and build the sources by running `npm run compile` and `npm run build`.


## Deploy FinP2P proxy contract

FinP2P proxy contract could be deployed using `deploy` script:

Change the folder to `finp2p-contracts` and run:

`npm run deploy-contract -- $ETHEREUM_RPC_URL $PRIVATE_KEY $OPERATOR_ADDRESS`

Where:

- `$ETHEREUM_RPC_URL` - Ethereum network url
- `$PRIVATE_KEY` - Private key of the account that will deploy the contract
- `$OPERATOR_ADDRESS` - Address of the operator account
  which would be granted with `OPERATOR` and `TRANSACTION_MANAGER` roles and could be used latter as an OPERATOR_ADDRESS parameter in the adapter configuration.


## Grant roles FinP2P proxy contract

In order to grant roles to the operator account, use `grant-roles` script:

`npm run grant-roles -- $ETHEREUM_RPC_URL $FINP2P_TOKEN_ADDRESS $DEPLOYER_PRIVATE_KEY $OPERATOR_ADDRESS`

Where:

- `$ETHEREUM_RPC_URL` - Ethereum network url
- `$FINP2P_TOKEN_ADDRESS` - FinP2P proxy contract address
- `$DEPLOYER_PRIVATE_KEY` - Private key of the account which deployed the contract
- `$OPERATOR_ADDRESS` - Address of the operator account
  which would be granted with `OPERATOR` and `TRANSACTION_MANAGER` roles and could be used latter as an OPERATOR_ADDRESS parameter in the adapter configuration.

#### Associate FinP2P asset with actual token address

In order to associate FinP2P asset with actual token address, use `associate-asset` script:

`npm run associate-asset -- $ETHEREUM_RPC_URL $FINP2P_PROXY_ADDRESS $DEPLOYER_PRIVATE_KEY $ASSET_ID $TOKEN_ADDRESS

Where:

- `$ETHEREUM_RPC_URL` - Ethereum network url
- `$FINP2P_PROXY_ADDRESS` - FinP2P proxy contract address
- `$DEPLOYER_PRIVATE_KEY` - Private key of the account which deployed the contract
- `$ASSET_ID` - FinP2P asset id
- `$TOKEN_ADDRESS` - Actual token address
