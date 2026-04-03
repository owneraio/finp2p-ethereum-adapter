import { ContractTransactionResponse, Provider, Signer } from 'ethers';
import winston from 'winston';
import { TokenWallet, AssetRecord, DeployResult } from './types';
/**
 * Token standard implementation for direct-mode operations.
 *
 * Each mutating method returns a ContractTransactionResponse that the adapter
 * awaits via tx.wait(). The adapter owns gas funding, receipt shaping,
 * logging, and error handling — the standard only constructs the on-chain call.
 *
 * Implement this interface in a plugin package and register it with the
 * adapter's tokenStandardRegistry at bootstrap.
 */
export interface TokenStandard {
    /**
     * Deploy a new token contract. Returns the contract address and metadata.
     * Called when createAsset has no tokenIdentifier binding.
     */
    deploy(wallet: TokenWallet, name: string, symbol: string, decimals: number, logger: winston.Logger): Promise<DeployResult>;
    /**
     * Query the balance of an address for the given asset.
     */
    balanceOf(provider: Provider, signer: Signer, asset: AssetRecord, address: string, logger: winston.Logger): Promise<bigint>;
    /**
     * Mint tokens to an address.
     */
    mint(wallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: winston.Logger): Promise<ContractTransactionResponse>;
    /**
     * Transfer tokens from the signer's address to another address.
     */
    transfer(wallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: winston.Logger): Promise<ContractTransactionResponse>;
    /**
     * Burn tokens from a given address (operator burn).
     */
    burn(wallet: TokenWallet, asset: AssetRecord, from: string, amount: bigint, logger: winston.Logger): Promise<ContractTransactionResponse>;
    /**
     * Hold (escrow) tokens for a pending settlement.
     *
     * The sourceWallet signs the transaction. The escrowWallet is provided
     * so the standard can decide where funds go:
     * - ERC20: trivializes to transfer(sourceWallet → escrowAddress)
     * - Other standards may use native lock/escrow mechanics
     */
    hold(sourceWallet: TokenWallet, escrowWallet: TokenWallet, asset: AssetRecord, amount: bigint, logger: winston.Logger): Promise<ContractTransactionResponse>;
    /**
     * Release held tokens to a destination address.
     *
     * The escrowWallet signs the transaction:
     * - ERC20: trivializes to transfer(escrowWallet → destinationAddress)
     * - Other standards may use native release/unlock mechanics
     */
    release(escrowWallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: winston.Logger): Promise<ContractTransactionResponse>;
}
//# sourceMappingURL=interface.d.ts.map