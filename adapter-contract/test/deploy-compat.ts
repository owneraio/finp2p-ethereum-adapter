// Compile-only: deploy signatures already published by plugins stay assignable to the SPI.
import type { DeployResult, Logger, TokenStandard, TokenWallet } from '../src';

type Deploy = Pick<TokenStandard, 'deploy'>;
declare const result: DeployResult;

export const fiveArguments: Deploy = {
  async deploy(_wallet: TokenWallet, _name: string, _symbol: string, _decimals: number, _logger: Logger) { return result; },
};

export const operatorOptions: Deploy = {
  async deploy(_wallet: TokenWallet, _name: string, _symbol: string, _decimals: number, _logger: Logger, opts?: { operatorAddress?: string }) {
    return { ...result, contractAddress: opts?.operatorAddress ?? result.contractAddress };
  },
};

export const readsContext: Deploy = {
  async deploy(_wallet, _name, _symbol, decimals, _logger, options) {
    const denomination = options?.context?.denomination?.type;
    const exhaustive = denomination === 'finp2p' || denomination === 'fiat' || denomination === 'cryptocurrency' || denomination === undefined;
    return { contractAddress: options?.context?.assetId ?? '', decimals: exhaustive ? decimals : 0, tokenStandard: 'X' };
  },
};
