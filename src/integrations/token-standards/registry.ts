import { TokenStandard } from '@owneraio/finp2p-ethereum-adapter-contract';

/**
 * Where a standard's hold() leaves the held tokens — the fact that decides how
 * a held redemption (redeem carrying an operationId) settles:
 *
 * - 'escrow-transfer': hold() moved the tokens into the escrow wallet, so a
 *   held redemption burns the escrow wallet's own balance.
 * - 'holder-reservation': hold() reserved the tokens on the holder's account
 *   and the escrow wallet is only an authority that never holds tokens, so a
 *   held redemption must settle through release() with ReleaseType.Redeem,
 *   which resolves the reservation by its operationId and burns from the
 *   holder.
 */
export type HoldModel = 'escrow-transfer' | 'holder-reservation';

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
  private standards = new Map<string, { impl: TokenStandard; holdModel: HoldModel }>();

  register(tokenStandard: string, impl: TokenStandard, holdModel: HoldModel = 'escrow-transfer'): void {
    const key = tokenStandard.toUpperCase();
    if (this.standards.has(key)) {
      throw new Error(`Token standard '${tokenStandard}' is already registered`);
    }
    this.standards.set(key, { impl, holdModel });
  }

  resolve(tokenStandard: string): TokenStandard {
    return this.entry(tokenStandard).impl;
  }

  holdModel(tokenStandard: string): HoldModel {
    return this.entry(tokenStandard).holdModel;
  }

  private entry(tokenStandard: string): { impl: TokenStandard; holdModel: HoldModel } {
    const key = tokenStandard.toUpperCase();
    const entry = this.standards.get(key);
    if (!entry) {
      const available = Array.from(this.standards.keys()).join(', ');
      throw new Error(`Unknown token standard: '${tokenStandard}'. Available: ${available}`);
    }
    return entry;
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
