import { TokenStandard } from '@owneraio/finp2p-ethereum-ownera';

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
export interface TokenStandardOptions {
  /**
   * The standard's tokens expose IERC20Metadata (decimals/name/symbol): bound
   * assets read decimals() on-chain and get registered with custody providers.
   * Non-compatible standards (collateral registries) keep decimals = 0 and
   * skip custody registration.
   */
  erc20Compatible?: boolean;
}

type Registration = { impl: TokenStandard, erc20Compatible: boolean };

class TokenStandardRegistry {
  private standards = new Map<string, Registration>();

  register(tokenStandard: string, impl: TokenStandard, options: TokenStandardOptions = {}): void {
    const key = tokenStandard.toUpperCase();
    if (this.standards.has(key)) {
      throw new Error(`Token standard '${tokenStandard}' is already registered`);
    }
    this.standards.set(key, { impl, erc20Compatible: options.erc20Compatible ?? false });
  }

  resolve(tokenStandard: string): TokenStandard {
    const key = tokenStandard.toUpperCase();
    const registration = this.standards.get(key);
    if (!registration) {
      const available = Array.from(this.standards.keys()).join(', ');
      throw new Error(`Unknown token standard: '${tokenStandard}'. Available: ${available}`);
    }
    return registration.impl;
  }

  isErc20Compatible(tokenStandard: string): boolean {
    return this.standards.get(tokenStandard.toUpperCase())?.erc20Compatible ?? false;
  }

  has(tokenStandard: string): boolean {
    return this.standards.has(tokenStandard.toUpperCase());
  }

  get availableStandards(): string[] {
    return Array.from(this.standards.keys());
  }

  /** Test hook: drop all registrations so a suite can exercise both registration modes. */
  reset(): void {
    this.standards.clear();
  }
}

export const tokenStandardRegistry = new TokenStandardRegistry();
