import { ContractTransactionResponse, Provider, Signer } from 'ethers';
import winston from 'winston';
import { CustodyWallet } from './custody-provider';

/**
 * Stored asset data from the DB, used to resolve the token standard.
 */
export interface AssetRecord {
  contract_address: string;
  decimals: number;
  token_standard: string;
}

/**
 * Result of deploying a new token contract.
 */
export interface DeployResult {
  contractAddress: string;
  decimals: number;
  tokenStandard: string;
}

/**
 * Token standard implementation for direct-mode ERC20-style operations.
 *
 * Each method returns a ContractTransactionResponse that the adapter
 * awaits via tx.wait(). The adapter owns gas funding, receipt shaping,
 * logging, and error handling — the standard only constructs the on-chain call.
 */
export interface TokenStandard {
  /**
   * Deploy a new token contract. Returns the contract address and metadata.
   * Called when createAsset has no tokenIdentifier binding.
   */
  deploy(
    wallet: CustodyWallet,
    name: string,
    symbol: string,
    decimals: number,
    logger: winston.Logger,
  ): Promise<DeployResult>;

  /**
   * Query the balance of an address for the given asset.
   */
  balanceOf(
    provider: Provider,
    signer: Signer,
    asset: AssetRecord,
    address: string,
    logger: winston.Logger,
  ): Promise<bigint>;

  /**
   * Mint tokens to an address.
   */
  mint(
    wallet: CustodyWallet,
    asset: AssetRecord,
    to: string,
    amount: bigint,
    logger: winston.Logger,
  ): Promise<ContractTransactionResponse>;

  /**
   * Transfer tokens from the signer's address to another address.
   */
  transfer(
    wallet: CustodyWallet,
    asset: AssetRecord,
    to: string,
    amount: bigint,
    logger: winston.Logger,
  ): Promise<ContractTransactionResponse>;

  /**
   * Burn tokens from a given address (operator burn).
   */
  burn(
    wallet: CustodyWallet,
    asset: AssetRecord,
    from: string,
    amount: bigint,
    logger: winston.Logger,
  ): Promise<ContractTransactionResponse>;
}
