import { isAddress } from "ethers";
import process from "process";
import { SwapVenue } from "@owneraio/finp2p-ethereum-adapter-contract";
import { AllowanceSwapVenue } from "@owneraio/finp2p-ethereum-allowance-swap";

/** A venue with the name it is reported under in the asset's capability list. */
export type NamedSwapVenue = {
  name: string;
  description: string;
  venue: SwapVenue;
};

export const DEFAULT_VENUE_NAME = "AllowanceSwap";
export const VENUE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const ALLOWANCE_SWAP_DESCRIPTION = "Settles both legs in one transaction from approved allowances";
const PLURAL_VARIABLE = "FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES";
const SINGULAR_VARIABLE = "FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS";
const ADDRESS_SUFFIX_LENGTH = 8;

const parseVenueAddress = (variable: string, value: string): string => {
  if (!isAddress(value)) {
    throw new Error(`Invalid ${variable}: '${value}' is not an Ethereum address`);
  }
  return value;
};

/** `Name=0xaddress` or a bare `0xaddress`. */
const parseEntry = (raw: string): { name?: string; address: string } => {
  const separator = raw.indexOf("=");
  if (separator < 0) {
    return { address: parseVenueAddress(PLURAL_VARIABLE, raw) };
  }
  const name = raw.slice(0, separator).trim();
  if (!VENUE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid venue name in ${PLURAL_VARIABLE}: '${name}' must match ${VENUE_NAME_PATTERN}`);
  }
  return { name, address: parseVenueAddress(PLURAL_VARIABLE, raw.slice(separator + 1).trim()) };
};

/**
 * An unnamed entry is called `AllowanceSwap` when it is the only venue and
 * `AllowanceSwap-<first 8 hex digits of the address, lower case>` otherwise,
 * so every adapter configured with the same address derives the same name.
 */
const defaultName = (address: string, total: number): string =>
  total === 1 ? DEFAULT_VENUE_NAME : `${DEFAULT_VENUE_NAME}-${address.slice(2, 2 + ADDRESS_SUFFIX_LENGTH).toLowerCase()}`;

const allowanceSwap = (name: string, address: string): NamedSwapVenue => ({
  name,
  description: ALLOWANCE_SWAP_DESCRIPTION,
  venue: new AllowanceSwapVenue(address),
});

/**
 * Swap venues in preference order. The plural variable wins over the singular
 * one; its entries are `0xaddress` or `Name=0xaddress`. Duplicate addresses (any
 * letter case) and duplicate names are rejected.
 */
export const detectSwapVenues = (
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = () => undefined,
): NamedSwapVenue[] => {
  const plural = env[PLURAL_VARIABLE];
  const singular = env[SINGULAR_VARIABLE];
  if (plural) {
    if (singular) {
      warn(`${SINGULAR_VARIABLE} is ignored because ${PLURAL_VARIABLE} is set`);
    }
    const entries = plural.split(",").map((raw) => raw.trim()).filter((raw) => raw !== "").map(parseEntry);
    const addresses = new Set<string>();
    const names = new Set<string>();
    return entries.map(({ name, address }) => {
      const resolved = name ?? defaultName(address, entries.length);
      if (addresses.has(address.toLowerCase())) {
        throw new Error(`Duplicate address in ${PLURAL_VARIABLE}: '${address}'`);
      }
      if (names.has(resolved)) {
        throw new Error(`Duplicate venue name in ${PLURAL_VARIABLE}: '${resolved}'`);
      }
      addresses.add(address.toLowerCase());
      names.add(resolved);
      return allowanceSwap(resolved, address);
    });
  }
  if (singular) {
    return [allowanceSwap(DEFAULT_VENUE_NAME, parseVenueAddress(SINGULAR_VARIABLE, singular))];
  }
  return [];
};

export const detectSwapVenue = (env: NodeJS.ProcessEnv = process.env): SwapVenue | undefined =>
  detectSwapVenues(env)[0]?.venue;
