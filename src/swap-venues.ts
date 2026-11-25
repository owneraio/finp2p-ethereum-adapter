import { isAddress } from "ethers";
import process from "process";
import { SwapVenue } from "@owneraio/finp2p-ethereum-adapter-contract";
import { AllowanceSwapVenue } from "@owneraio/finp2p-ethereum-allowance-swap";
import { PERMIT2_ADDRESS, Permit2SwapVenue } from "@owneraio/finp2p-ethereum-permit2-swap";

/**
 * A venue with the name it is logged under. `listedAddress` is the contract
 * the asset lists for swap and the router sends back in the execution context.
 * For a Permit2 venue it is the Permit2Swap contract, not `venue.venueAddress`.
 */
export type NamedSwapVenue = {
  name: string;
  listedAddress: string;
  venue: SwapVenue;
};

export const DEFAULT_VENUE_NAME = "AllowanceSwap";
export const DEFAULT_PERMIT2_VENUE_NAME = "Permit2Swap";
export const VENUE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const PLURAL_VARIABLE = "FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES";
const SINGULAR_VARIABLE = "FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS";
const PERMIT2_SWAP_VARIABLE = "FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES";
const PERMIT2_VARIABLE = "FINP2P_ETHEREUM_PERMIT2_ADDRESS";
const ADDRESS_SUFFIX_LENGTH = 8;

type VenueList = {
  variable: string;
  defaultName: string;
  create: (name: string, address: string) => NamedSwapVenue;
};

const parseVenueAddress = (variable: string, value: string): string => {
  if (!isAddress(value)) {
    throw new Error(`Invalid ${variable}: '${value}' is not an Ethereum address`);
  }
  return value;
};

/** `Name=0xaddress` or a bare `0xaddress`. */
const parseEntry = (variable: string, raw: string): { name?: string; address: string } => {
  const separator = raw.indexOf("=");
  if (separator < 0) {
    return { address: parseVenueAddress(variable, raw) };
  }
  const name = raw.slice(0, separator).trim();
  if (!VENUE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid venue name in ${variable}: '${name}' must match ${VENUE_NAME_PATTERN}`);
  }
  return { name, address: parseVenueAddress(variable, raw.slice(separator + 1).trim()) };
};

/**
 * An unnamed entry is called by the list's default name when it is the only
 * venue and `<default name>-<first 8 hex digits of the address, lower case>`
 * otherwise, so every adapter configured with the same address derives the same name.
 */
const defaultName = (base: string, address: string, total: number): string =>
  total === 1 ? base : `${base}-${address.slice(2, 2 + ADDRESS_SUFFIX_LENGTH).toLowerCase()}`;

const allowanceSwap = (name: string, address: string): NamedSwapVenue => ({
  name,
  listedAddress: address,
  venue: new AllowanceSwapVenue(address),
});

const allowanceList: VenueList = {
  variable: PLURAL_VARIABLE,
  defaultName: DEFAULT_VENUE_NAME,
  create: allowanceSwap,
};

const permit2List = (env: NodeJS.ProcessEnv): VenueList => {
  const permit2Address = parseVenueAddress(PERMIT2_VARIABLE, env[PERMIT2_VARIABLE] || PERMIT2_ADDRESS);
  return {
    variable: PERMIT2_SWAP_VARIABLE,
    defaultName: DEFAULT_PERMIT2_VENUE_NAME,
    create: (name, address) => ({
      name,
      listedAddress: address,
      venue: new Permit2SwapVenue(address, permit2Address),
    }),
  };
};

const venuesOf = (list: VenueList, value: string): NamedSwapVenue[] => {
  const entries = value.split(",").map((raw) => raw.trim()).filter((raw) => raw !== "")
    .map((raw) => parseEntry(list.variable, raw));
  const addresses = new Set<string>();
  const names = new Set<string>();
  return entries.map(({ name, address }) => {
    const resolved = name ?? defaultName(list.defaultName, address, entries.length);
    if (addresses.has(address.toLowerCase())) {
      throw new Error(`Duplicate address in ${list.variable}: '${address}'`);
    }
    if (names.has(resolved)) {
      throw new Error(`Duplicate venue name in ${list.variable}: '${resolved}'`);
    }
    addresses.add(address.toLowerCase());
    names.add(resolved);
    return list.create(resolved, address);
  });
};

const rejectClashes = (venues: NamedSwapVenue[]): void => {
  const addresses = new Set<string>();
  const names = new Set<string>();
  venues.forEach(({ name, listedAddress }) => {
    const address = listedAddress.toLowerCase();
    if (addresses.has(address)) {
      throw new Error(`Duplicate address across swap venue lists: '${listedAddress}'`);
    }
    if (names.has(name)) {
      throw new Error(`Duplicate venue name across swap venue lists: '${name}'`);
    }
    addresses.add(address);
    names.add(name);
  });
};

/**
 * Swap venues: allowance venues first, then Permit2 venues. Custody providers
 * use the first venue, and a swap with no contract requested runs on it. The
 * plural allowance variable wins over the singular one. Entries of both lists
 * are `0xaddress` or `Name=0xaddress`; addresses (any letter case) and names
 * must be unique across both lists.
 */
export const detectSwapVenues = (
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = () => undefined,
): NamedSwapVenue[] => {
  const plural = env[PLURAL_VARIABLE];
  const singular = env[SINGULAR_VARIABLE];
  let allowance: NamedSwapVenue[] = [];
  if (plural) {
    if (singular) {
      warn(`${SINGULAR_VARIABLE} is ignored because ${PLURAL_VARIABLE} is set`);
    }
    allowance = venuesOf(allowanceList, plural);
  } else if (singular) {
    allowance = [allowanceSwap(DEFAULT_VENUE_NAME, parseVenueAddress(SINGULAR_VARIABLE, singular))];
  }
  const permit2Swap = env[PERMIT2_SWAP_VARIABLE];
  const permit2 = permit2Swap ? venuesOf(permit2List(env), permit2Swap) : [];
  const venues = [...allowance, ...permit2];
  rejectClashes(venues);
  return venues;
};

/**
 * Leaves Permit2 venues out, warning once for each. The operator relays in
 * `finp2p-contract` mode and cannot grant the Permit2 allowance for a party.
 */
export const withoutPermit2Venues = (
  venues: NamedSwapVenue[],
  warn: (message: string) => void,
): NamedSwapVenue[] =>
  venues.filter(({ name, listedAddress, venue }) => {
    if (!(venue instanceof Permit2SwapVenue)) {
      return true;
    }
    warn(`Permit2 swap venue ${name} at ${listedAddress} is not used: the operator cannot grant the Permit2 allowance in finp2p-contract mode`);
    return false;
  });

/** The contract a venue is listed under: its swap contract when it has one, else its funds-entry address. */
const listedAddressOf = (venue: SwapVenue): string => {
  const { swapAddress } = venue as { swapAddress?: unknown };
  return typeof swapAddress === "string" ? swapAddress : venue.venueAddress;
};

/** The venue list of an app config, falling back to the single `swapVenue` of older configs. */
export const venuesFromConfig = (config: { swapVenues?: NamedSwapVenue[]; swapVenue?: SwapVenue }): NamedSwapVenue[] => {
  if (config.swapVenues) {
    return config.swapVenues;
  }
  return config.swapVenue
    ? [{ name: DEFAULT_VENUE_NAME, listedAddress: listedAddressOf(config.swapVenue), venue: config.swapVenue }]
    : [];
};
