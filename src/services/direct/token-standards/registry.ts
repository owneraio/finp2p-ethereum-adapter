import { TokenStandard } from '@owneraio/finp2p-ethereum-token-standard';

/**
 * Signing mode determines how the adapter resolves wallets for operations:
 *
 * - per-investor: each operation resolves the investor's custody wallet.
 *   hold/transfer use the investor wallet, release/rollback use escrow.
 *
 * - operator: the standard owns its own operator signer internally.
 *   The adapter does not resolve investor wallets — all operations
 *   receive a read-only provider wallet (the standard ignores it).
 */
export type SigningMode = 'per-investor' | 'operator';

interface RegisteredStandard {
  impl: TokenStandard;
  signingMode: SigningMode;
}

/**
 * Registry for token standard implementations in direct mode.
 *
 * Each registered standard handles the on-chain call construction for
 * deploy, balanceOf, mint, transfer, and burn. The adapter resolves the
 * implementation from the stored asset's `token_standard` field.
 *
 * Registration is explicit at bootstrap — the adapter registers built-in
 * ERC20 and plugin packages may register additional standards.
 */
class TokenStandardRegistry {
  private standards = new Map<string, RegisteredStandard>();

  register(tokenStandard: string, impl: TokenStandard, signingMode: SigningMode = 'per-investor'): void {
    const key = tokenStandard.toUpperCase();
    if (this.standards.has(key)) {
      throw new Error(`Token standard '${tokenStandard}' is already registered`);
    }
    this.standards.set(key, { impl, signingMode });
  }

  resolve(tokenStandard: string): TokenStandard {
    return this.resolveEntry(tokenStandard).impl;
  }

  signingMode(tokenStandard: string): SigningMode {
    return this.resolveEntry(tokenStandard).signingMode;
  }

  has(tokenStandard: string): boolean {
    return this.standards.has(tokenStandard.toUpperCase());
  }

  get availableStandards(): string[] {
    return Array.from(this.standards.keys());
  }

  private resolveEntry(tokenStandard: string): RegisteredStandard {
    const key = tokenStandard.toUpperCase();
    const entry = this.standards.get(key);
    if (!entry) {
      const available = Array.from(this.standards.keys()).join(', ');
      throw new Error(`Unknown token standard: '${tokenStandard}'. Available: ${available}`);
    }
    return entry;
  }
}

export const tokenStandardRegistry = new TokenStandardRegistry();
