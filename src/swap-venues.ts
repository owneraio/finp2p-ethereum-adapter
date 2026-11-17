import { isAddress } from "ethers";
import process from "process";
import { SwapVenue } from "@owneraio/finp2p-ethereum-adapter-contract";
import { AllowanceSwapVenue } from "@owneraio/finp2p-ethereum-allowance-swap";

const parseVenueAddress = (name: string, value: string): string => {
  if (!isAddress(value)) {
    throw new Error(`Invalid ${name}: '${value}' is not an Ethereum address`);
  }
  return value;
};

/**
 * Swap venues in preference order. The plural variable wins over the singular
 * one; duplicates (any letter case) are rejected.
 */
export const detectSwapVenues = (
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = () => undefined,
): SwapVenue[] => {
  const plural = env.FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES;
  const singular = env.FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS;
  if (plural) {
    if (singular) {
      warn('FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is ignored because FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES is set');
    }
    const seen = new Set<string>();
    return plural.split(',').map((raw) => raw.trim()).filter((raw) => raw !== '').map((raw) => {
      const address = parseVenueAddress('FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES', raw);
      const key = address.toLowerCase();
      if (seen.has(key)) {
        throw new Error(`Duplicate address in FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: '${address}'`);
      }
      seen.add(key);
      return new AllowanceSwapVenue(address);
    });
  }
  if (singular) {
    return [new AllowanceSwapVenue(parseVenueAddress('FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS', singular))];
  }
  return [];
};

export const detectSwapVenue = (env: NodeJS.ProcessEnv = process.env): SwapVenue | undefined =>
  detectSwapVenues(env)[0];
