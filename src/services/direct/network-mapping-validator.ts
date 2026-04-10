import { NetworkMappingValidator, ValidationError } from '@owneraio/finp2p-nodejs-skeleton-adapter';

export const FIELD_CHAIN_ID = 'chainId';
export const FIELD_RPC_URL = 'rpcUrl';
export const FIELD_SUBMIT_MODE = 'submitMode';
export const FIELD_FINALITY_CONFIRMATIONS = 'finalityConfirmations';

const VALID_SUBMIT_MODES = ['custody-submit', 'adapter-submit'];

/**
 * Validates EVM network mapping fields.
 * Ensures chainId is a valid number, rpcUrl is a URL,
 * submitMode is one of the known values, and finalityConfirmations is a non-negative integer.
 */
export class EvmNetworkMappingValidator implements NetworkMappingValidator {

  async validate(networkId: string, fields: Record<string, string>): Promise<Record<string, string>> {
    const chainId = fields[FIELD_CHAIN_ID];
    if (chainId !== undefined) {
      const parsed = Number(chainId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ValidationError(`Invalid chainId: '${chainId}' — must be a positive integer`);
      }
    }

    const rpcUrl = fields[FIELD_RPC_URL];
    if (rpcUrl !== undefined) {
      try {
        new URL(rpcUrl);
      } catch {
        throw new ValidationError(`Invalid rpcUrl: '${rpcUrl}' — must be a valid URL`);
      }
    }

    const submitMode = fields[FIELD_SUBMIT_MODE];
    if (submitMode !== undefined && !VALID_SUBMIT_MODES.includes(submitMode)) {
      throw new ValidationError(`Invalid submitMode: '${submitMode}' — must be one of: ${VALID_SUBMIT_MODES.join(', ')}`);
    }

    const confirmations = fields[FIELD_FINALITY_CONFIRMATIONS];
    if (confirmations !== undefined) {
      const parsed = Number(confirmations);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new ValidationError(`Invalid finalityConfirmations: '${confirmations}' — must be a non-negative integer`);
      }
    }

    return fields;
  }
}

export const EVM_NETWORK_FIELDS = [
  { field: FIELD_CHAIN_ID, description: 'EVM chain ID (e.g. 1 for mainnet, 11155111 for Sepolia)', exampleValue: '11155111' },
  { field: FIELD_RPC_URL, description: 'JSON-RPC endpoint URL', exampleValue: 'https://ethereum-sepolia-rpc.publicnode.com' },
  { field: FIELD_SUBMIT_MODE, description: 'Transaction submission mode', exampleValue: 'custody-submit' },
  { field: FIELD_FINALITY_CONFIRMATIONS, description: 'Number of block confirmations before finality', exampleValue: '1' },
];
