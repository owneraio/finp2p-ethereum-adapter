import { Provider, Signer } from 'ethers';
/**
 * Minimal logger interface. Structurally compatible with winston, console, or any logger.
 */
export interface Logger {
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
}
/**
 * A wallet with a provider and signer, used for signing and submitting transactions.
 * Mirrors the adapter's CustodyWallet without coupling to the adapter package.
 */
export interface TokenWallet {
    provider: Provider;
    signer: Signer;
}
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
//# sourceMappingURL=types.d.ts.map