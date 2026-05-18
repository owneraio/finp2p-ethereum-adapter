import { formatUnits, isAddress, parseUnits } from "ethers";
import { Logger, ConsoleLogger } from "../src/adapter-types";
import { ContractsManager, ERC20Contract, MINTER_ROLE, finIdToAddress } from "../src";
import { createJsonProvider, parseConfig } from "./config";

const logger: Logger = new ConsoleLogger("info");


const deploy = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  operatorAddress: string,
  assetName: string,
  assetSymbol: string,
  tokenDecimals: number,
  minterAddress?: string,
  mintAmount?: string,
  mintToFinId?: string,
  mintToAddress?: string,
) => {
  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);
  const contractManger = new ContractsManager(provider, signer, logger);
  logger.info("Deploying from env variables...");
  const erc20Address = await contractManger.deployERC20(assetName, assetSymbol, tokenDecimals, operatorAddress);
  logger.info(JSON.stringify({ erc20Address }));

  const erc20 = new ERC20Contract(provider, signer, erc20Address, logger);

  if (minterAddress) {
    if (!isAddress(minterAddress)) {
      throw new Error(`Invalid minter address: ${minterAddress}`);
    }
    logger.info(`Granting MINTER_ROLE to ${minterAddress}...`);
    const grantTx = await erc20.grantMinterTo(minterAddress);
    logger.info(`grantMinterTo tx-hash: ${grantTx.hash}`);
    await grantTx.wait();
  }

  if (mintAmount) {
    let recipient: string;
    if (mintToAddress) {
      if (!isAddress(mintToAddress)) {
        throw new Error(`Invalid mint-to address: ${mintToAddress}`);
      }
      recipient = mintToAddress;
    } else if (mintToFinId) {
      recipient = finIdToAddress(mintToFinId);
      logger.info(`Derived address ${recipient} from finId ${mintToFinId}`);
    } else {
      recipient = operatorAddress;
      logger.info(`No mint recipient provided, minting to operator address ${recipient}`);
    }

    const signerAddress = await signer.getAddress();
    if (!(await erc20.hasRole(MINTER_ROLE, signerAddress))) {
      logger.info(`Signer ${signerAddress} lacks MINTER_ROLE — granting it (deployer holds admin role)...`);
      const selfGrantTx = await erc20.grantMinterTo(signerAddress);
      logger.info(`grantMinterTo(self) tx-hash: ${selfGrantTx.hash}`);
      await selfGrantTx.wait();
    }

    const quantity = parseUnits(mintAmount, tokenDecimals);
    logger.info(`Minting ${mintAmount} ${assetSymbol} (${quantity.toString()} base units) to ${recipient}...`);
    const txResp = await erc20.mint(recipient, quantity);
    logger.info(`mint tx-hash: ${txResp.hash}`);
    await txResp.wait();
    const balance = await erc20.balanceOf(recipient);
    logger.info(`Recipient balance: ${formatUnits(balance, tokenDecimals)} ${assetSymbol}`);
  }
};

const config = parseConfig([
  {
    name: "operator_pk",
    envVar: "OPERATOR_PRIVATE_KEY",
    required: true,
    description: "Operator private key"
  },
  {
    name: "rpc_url",
    envVar: "RPC_URL",
    required: true,
    description: "Ethereum RPC URL"
  },
  {
    name: "operator_address",
    envVar: "OPERATOR_ADDRESS",
    description: "Operator address",
    required: true
  },
  {
    name: "asset_name",
    envVar: "ASSET_NAME",
    description: "Asset name",
    required: true
  },
  {
    name: "asset_symbol",
    envVar: "ASSET_SYMBOL",
    description: "Asset symbol",
    required: true
  },
  {
    name: "token_decimals",
    envVar: "TOKEN_DECIMALS",
    description: "Token decimals",
    required: true
  },
  {
    name: "minter_address",
    envVar: "MINTER_ADDRESS",
    description: "Optional address to grant MINTER_ROLE to (deployer holds admin role, not minter by default)"
  },
  {
    name: "mint_amount",
    envVar: "MINT_AMOUNT",
    description: "Optional amount to mint right after deploy (in token units, e.g. 1000000)"
  },
  {
    name: "mint_to_fin_id",
    envVar: "MINT_TO_FIN_ID",
    description: "Optional finId to mint to (address is derived). Used only if --mint-amount is set"
  },
  {
    name: "mint_to_address",
    envVar: "MINT_TO_ADDRESS",
    description: "Optional address to mint to. Takes precedence over --mint-to-fin-id. Falls back to operator address"
  }
]);


deploy(
  config.operator_pk!,
  config.rpc_url!,
  config.operator_address!,
  config.asset_name!,
  config.asset_symbol!,
  parseInt(config.token_decimals!),
  config.minter_address,
  config.mint_amount,
  config.mint_to_fin_id,
  config.mint_to_address,
)
  .then(() => {
  }).catch(console.error);
