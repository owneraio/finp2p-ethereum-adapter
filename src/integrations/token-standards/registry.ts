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
 * The ledger a standard is registered for when none is named: the chain this
 * adapter is configured against. Every asset record written so far belongs to
 * it, which is why a record without a ledger resolves exactly as it always has.
 */
const CONFIGURED_CHAIN = 'configured-chain';

/**
 * Registry for token standard implementations in direct mode.
 *
 * Each registered standard handles the on-chain call construction for
 * deploy, balanceOf, mint, transfer, and burn. The adapter resolves the
 * implementation from the stored asset's `token_standard` field, and from
 * its ledger (a CAIP-2 id) when the record carries one: the same standard
 * name may be served by a different instance on each ledger, since a plugin
 * instance is bound to one ledger's transport at construction.
 *
 * Registration is explicit at bootstrap — the adapter registers built-in
 * ERC20 and plugin packages may register additional standards.
 */
class TokenStandardRegistry {
  private standards = new Map<string, { impl: TokenStandard; holdModel: HoldModel }>();

  register(tokenStandard: string, impl: TokenStandard, holdModel: HoldModel = 'escrow-transfer', ledger?: string): void {
    const key = this.key(tokenStandard, ledger);
    if (this.standards.has(key)) {
      throw new Error(`Token standard '${tokenStandard}' is already registered${ledger ? ` for ${ledger}` : ''}`);
    }
    this.standards.set(key, { impl, holdModel });
  }

  /**
   * The implementation for a standard, on the configured chain unless a
   * ledger is named. A plugin registered for another ledger takes a wallet
   * of its own kind, so the caller names the contract it will drive it by.
   */
  resolve<S = TokenStandard>(tokenStandard: string, ledger?: string): S {
    return this.entry(tokenStandard, ledger).impl as unknown as S;
  }

  holdModel(tokenStandard: string, ledger?: string): HoldModel {
    return this.entry(tokenStandard, ledger).holdModel;
  }

  private entry(tokenStandard: string, ledger?: string): { impl: TokenStandard; holdModel: HoldModel } {
    const entry = this.standards.get(this.key(tokenStandard, ledger));
    if (!entry) {
      throw new Error(`Unknown token standard: '${tokenStandard}'${ledger ? ` on ${ledger}` : ''}. Available: ${this.availableStandards.join(', ')}`);
    }
    return entry;
  }

  has(tokenStandard: string, ledger?: string): boolean {
    return this.standards.has(this.key(tokenStandard, ledger));
  }

  /** Standard names on the configured chain; `<ledger>/<STANDARD>` for the rest. */
  get availableStandards(): string[] {
    return Array.from(this.standards.keys()).map(key => key.startsWith(`${CONFIGURED_CHAIN}/`) ? key.slice(CONFIGURED_CHAIN.length + 1) : key);
  }

  /** Test hook: drop all registrations so a suite can exercise both registration modes. */
  reset(): void {
    this.standards.clear();
  }

  private key(tokenStandard: string, ledger: string | undefined): string {
    return `${ledger ?? CONFIGURED_CHAIN}/${tokenStandard.toUpperCase()}`;
  }
}

export const tokenStandardRegistry = new TokenStandardRegistry();
