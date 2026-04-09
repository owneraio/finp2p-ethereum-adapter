import { tokenStandardRegistry } from './registry';
import { ERC20TokenStandard, ERC20_TOKEN_STANDARD } from './erc20';

/**
 * Register all built-in token standards.
 * Called once at bootstrap before any asset operations.
 */
export function registerBuiltinTokenStandards(): void {
  tokenStandardRegistry.register(ERC20_TOKEN_STANDARD, new ERC20TokenStandard());
}
