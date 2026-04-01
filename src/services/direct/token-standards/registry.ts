import { TokenStandard } from './interface';

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
  private standards = new Map<string, TokenStandard>();

  register(tokenStandard: string, impl: TokenStandard): void {
    const key = tokenStandard.toUpperCase();
    if (this.standards.has(key)) {
      throw new Error(`Token standard '${tokenStandard}' is already registered`);
    }
    this.standards.set(key, impl);
  }

  resolve(tokenStandard: string): TokenStandard {
    const key = tokenStandard.toUpperCase();
    const impl = this.standards.get(key);
    if (!impl) {
      const available = Array.from(this.standards.keys()).join(', ');
      throw new Error(`Unknown token standard: '${tokenStandard}'. Available: ${available}`);
    }
    return impl;
  }

  has(tokenStandard: string): boolean {
    return this.standards.has(tokenStandard.toUpperCase());
  }

  get availableStandards(): string[] {
    return Array.from(this.standards.keys());
  }
}

export const tokenStandardRegistry = new TokenStandardRegistry();
