/**
 * Compile-only fixtures. Nothing here runs; `tsc --noEmit` over this file is
 * the test. It proves two things about the SPI at once: a plugin written
 * against the ethers-shaped contract still implements `TokenStandard` with no
 * type argument, and a plugin for a ledger that signs bytes implements
 * `TokenStandard<MessageSigner>` and `InvestorWhitelisting<MessageSigner>`
 * without ethers appearing anywhere in its own code.
 */
import type { Provider, Signer } from 'ethers';
import {
  AssetRecord, DeployResult, InvestorWhitelisting, Logger, MessageSigner, TokenOperationResult, TokenStandard, TokenWallet,
  WhitelistParty, failedTokenOp, signsMessages, successfulTokenOp, supportsWhitelisting,
} from '../../src';

/** An EVM plugin exactly as they exist today: TokenWallet everywhere, no type argument. */
class EthersShapedStandard implements TokenStandard {
  async deploy(wallet: TokenWallet, name: string, symbol: string, decimals: number): Promise<DeployResult> {
    void wallet.signer; void name; void symbol;
    return { contractAddress: '0x0', decimals, tokenStandard: 'ERC20' };
  }
  async decimals(provider: Provider): Promise<number> { void provider; return 18; }
  async balanceOf(provider: Provider, signer: Signer): Promise<string> { void provider; void signer; return '0'; }
  async mint(wallet: TokenWallet): Promise<TokenOperationResult> { void wallet.provider; return successfulTokenOp('tx', 0); }
  async transfer(wallet: TokenWallet): Promise<TokenOperationResult> { void wallet; return successfulTokenOp('tx', 0); }
  async burn(wallet: TokenWallet): Promise<TokenOperationResult> { void wallet; return successfulTokenOp('tx', 0); }
  async hold(source: TokenWallet, escrow: TokenWallet): Promise<TokenOperationResult> { void source; void escrow; return successfulTokenOp('tx', 0); }
  async release(escrow: TokenWallet): Promise<TokenOperationResult> { void escrow; return successfulTokenOp('tx', 0); }
}

/** A Stellar-like plugin: writes are authorised by a MessageSigner and a trustline is signed by the holder. */
class BytesSignedStandard implements TokenStandard<MessageSigner>, InvestorWhitelisting<MessageSigner> {
  async deploy(issuer: MessageSigner, name: string, symbol: string, decimals: number): Promise<DeployResult> {
    void name;
    return { contractAddress: `${symbol}:${issuer.address}`, decimals, tokenStandard: 'STELLAR_CLASSIC' };
  }
  async decimals(): Promise<number> { return 7; }
  async balanceOf(_provider: Provider, _signer: Signer, asset: AssetRecord, address: string): Promise<string> {
    void asset.ledger; void address;
    return '0';
  }
  async mint(issuer: MessageSigner): Promise<TokenOperationResult> {
    const signature = await issuer.sign(new Uint8Array(32));
    return successfulTokenOp(Buffer.from(signature).toString('hex'), 0);
  }
  async transfer(holder: MessageSigner): Promise<TokenOperationResult> { void holder; return successfulTokenOp('tx', 0); }
  async burn(holder: MessageSigner): Promise<TokenOperationResult> { void holder; return successfulTokenOp('tx', 0); }
  async hold(): Promise<TokenOperationResult> { return failedTokenOp('STELLAR_CLASSIC does not hold'); }
  async release(): Promise<TokenOperationResult> { return failedTokenOp('STELLAR_CLASSIC does not release'); }
  async isWhitelisted(asset: AssetRecord, party: WhitelistParty): Promise<boolean> { void asset; void party; return false; }
  async whitelist(asset: AssetRecord, party: WhitelistParty, logger: Logger, wallet?: MessageSigner): Promise<TokenOperationResult> {
    void asset; void logger;
    if (!wallet || wallet.address !== party.address) return failedTokenOp(`a trustline is signed by the holder ${party.address}`);
    return successfulTokenOp('tx', 0);
  }
  async dewhitelist(): Promise<TokenOperationResult> { return successfulTokenOp('tx', 0); }
}

// The default type argument keeps today's declarations meaningful.
const ethersShaped: TokenStandard = new EthersShapedStandard();
const bytesSigned: TokenStandard<MessageSigner> = new BytesSignedStandard();

// The capability probe narrows to the same wallet type as the standard.
if (supportsWhitelisting(bytesSigned)) {
  const holder: MessageSigner = { address: 'G…', sign: async () => new Uint8Array(64) };
  void bytesSigned.whitelist({ contractAddress: 'X:G…', decimals: 7, tokenStandard: 'STELLAR_CLASSIC', ledger: 'stellar:testnet' }, { address: holder.address, role: 'destination' }, console, holder);
}
if (supportsWhitelisting(ethersShaped)) {
  void ethersShaped.whitelist({ contractAddress: '0x0', decimals: 18, tokenStandard: 'ERC20' }, { address: '0x1', role: 'source' }, console);
}

// A bare LedgerWallet is not a MessageSigner until the guard says so.
const someone = { address: 'G…' } as const;
if (signsMessages(someone)) void someone.sign(new Uint8Array());

// @ts-expect-error a bytes-signed standard is not an ethers-shaped one
const wrong: TokenStandard = bytesSigned;
void wrong;
