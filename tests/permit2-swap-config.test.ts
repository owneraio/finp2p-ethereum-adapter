import { getAddress } from "ethers";
import { PERMIT2_ADDRESS, Permit2SwapVenue } from "@owneraio/finp2p-ethereum-permit2-swap";
import { detectSwapVenues, withoutPermit2Venues } from "../src/swap-venues";
import { onChainCapabilities, pickVenue } from "../src/services/onchain/capabilities";

const ALLOWANCE = "0x" + "bb".repeat(20);
const SWAP_A = "0x" + "cc".repeat(20);
const SWAP_B = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const LIST = "FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES";

describe("Permit2 swap venue configuration", () => {
  test("is off unless the list variable is set", () => {
    expect(detectSwapVenues({ FINP2P_ETHEREUM_PERMIT2_ADDRESS: SWAP_A })).toEqual([]);
    expect(detectSwapVenues({ [LIST]: "" })).toEqual([]);
  });

  test("a bare address gets the default name Permit2Swap", () => {
    const venues = detectSwapVenues({ [LIST]: SWAP_A });
    expect(venues).toHaveLength(1);
    expect(venues[0].name).toBe("Permit2Swap");
    expect(venues[0].venue).toBeInstanceOf(Permit2SwapVenue);
    expect(venues[0].listedAddress).toBe(SWAP_A);
    expect((venues[0].venue as Permit2SwapVenue).swapAddress).toBe(SWAP_A);
    expect(venues[0].venue.venueAddress).toBe(PERMIT2_ADDRESS);
  });

  test("several entries keep their names or derive one from the address", () => {
    const venues = detectSwapVenues({ [LIST]: `Desk=${SWAP_A},${SWAP_B}` });
    expect(venues.map((v) => v.name)).toEqual(["Desk", "Permit2Swap-a51c1fc2"]);
  });

  test("Permit2 venues follow the allowance venues and report as swap contracts", () => {
    const venues = detectSwapVenues({
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS: ALLOWANCE,
      [LIST]: SWAP_A,
    });
    expect(venues.map((v) => v.name)).toEqual(["AllowanceSwap", "Permit2Swap"]);
    const swap = onChainCapabilities(31337n, "0x" + "aa".repeat(20), venues)
      .find((c) => c.instruction === "INSTRUCTION_SWAP")!;
    expect(swap.contracts!.map((c) => c.address)).toEqual([
      `eip155:31337:${getAddress(ALLOWANCE)}`,
      `eip155:31337:${getAddress(SWAP_A)}`,
    ]);
  });

  test("a requested Permit2Swap contract is matched by address", () => {
    const venues = detectSwapVenues({ [LIST]: SWAP_A });
    const picked = pickVenue({ contract: `eip155:31337:${getAddress(SWAP_A)}` } as any, venues, 31337n);
    expect(picked).toEqual({ venue: venues[0].venue });
  });

  test("Permit2 itself is not a listed swap contract", () => {
    const venues = detectSwapVenues({ [LIST]: SWAP_A });
    const requested = `eip155:31337:${getAddress(PERMIT2_ADDRESS)}`;
    expect(pickVenue({ contract: requested } as any, venues, 31337n))
      .toEqual({ error: `contract ${requested} is not available for SWAP on this adapter` });
  });

  test("an address in both lists is a startup error, in any letter case", () => {
    const env = { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: ALLOWANCE, [LIST]: ALLOWANCE.toUpperCase().replace("0X", "0x") };
    expect(() => detectSwapVenues(env)).toThrow(/Duplicate address across swap venue lists/);
  });

  test("a duplicate address inside the list is a startup error", () => {
    expect(() => detectSwapVenues({ [LIST]: `${SWAP_A},B=${SWAP_A}` })).toThrow(/Duplicate address in FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES/);
  });

  test("the same name in both lists is a startup error", () => {
    const env = { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `Desk=${ALLOWANCE}`, [LIST]: `Desk=${SWAP_A}` };
    expect(() => detectSwapVenues(env)).toThrow(/Duplicate venue name across swap venue lists/);
  });

  test.each([
    ["not an address", { [LIST]: "0x123" }, /Invalid FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES/],
    ["a bad name", { [LIST]: `bad name=${SWAP_A}` }, /Invalid venue name in FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES/],
    ["a bad Permit2 address", { [LIST]: SWAP_A, FINP2P_ETHEREUM_PERMIT2_ADDRESS: "nope" }, /Invalid FINP2P_ETHEREUM_PERMIT2_ADDRESS/],
  ])("rejects %s", (_label, env, message) => {
    expect(() => detectSwapVenues(env)).toThrow(message);
  });

  test("the Permit2 address defaults to the canonical deployment and can be overridden", () => {
    const permit2Of = (env: NodeJS.ProcessEnv) =>
      detectSwapVenues({ [LIST]: SWAP_A, ...env })[0].venue.venueAddress;
    expect(permit2Of({})).toBe(PERMIT2_ADDRESS);
    expect(permit2Of({ FINP2P_ETHEREUM_PERMIT2_ADDRESS: SWAP_B })).toBe(SWAP_B);
  });
});

describe("Permit2 venues in finp2p-contract mode", () => {
  const env = {
    FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS: ALLOWANCE,
    [LIST]: `Desk=${SWAP_A},${SWAP_B}`,
  };

  test("are left out of the venue list, so none is reported or picked", () => {
    const venues = withoutPermit2Venues(detectSwapVenues(env), () => undefined);

    expect(venues.map((v) => v.name)).toEqual(["AllowanceSwap"]);
    const swap = onChainCapabilities(31337n, "0x" + "aa".repeat(20), venues)
      .find((c) => c.instruction === "INSTRUCTION_SWAP")!;
    expect(swap.contracts!.map((c) => c.address)).toEqual([`eip155:31337:${getAddress(ALLOWANCE)}`]);
    const requested = `eip155:31337:${getAddress(SWAP_A)}`;
    expect(pickVenue({ contract: requested } as any, venues, 31337n))
      .toEqual({ error: `contract ${requested} is not available for SWAP on this adapter` });
  });

  test("each one is named in a warning", () => {
    const warnings: string[] = [];
    withoutPermit2Venues(detectSwapVenues(env), (message) => warnings.push(message));

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain(`Desk at ${SWAP_A}`);
    expect(warnings[1]).toContain(`Permit2Swap-a51c1fc2 at ${SWAP_B}`);
  });

  test("with only Permit2 venues configured no venue remains", () => {
    expect(withoutPermit2Venues(detectSwapVenues({ [LIST]: SWAP_A }), () => undefined)).toEqual([]);
  });

  test("allowance venues stay and raise no warning", () => {
    const warnings: string[] = [];
    const venues = detectSwapVenues({ FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `${ALLOWANCE},${SWAP_A}` });

    expect(withoutPermit2Venues(venues, (message) => warnings.push(message))).toEqual(venues);
    expect(warnings).toEqual([]);
  });
});
