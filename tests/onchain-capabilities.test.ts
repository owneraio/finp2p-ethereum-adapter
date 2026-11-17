import { OnChainTokenService, InMemoryExecDetailsStore } from "../src/services/onchain";
import { onChainCapabilities, pickVenue, sameAddress } from "../src/services/onchain/capabilities";
import { detectSwapVenues } from "../src/swap-venues";

const OPERATOR = "0x" + "aa".repeat(20);
const VENUE_A = "0x" + "bb".repeat(20);
const VENUE_B = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const OTHER = "0x" + "cc".repeat(20);

const ASSET = { assetId: "bank-us:102:asset-1", assetType: "finp2p" } as any;
const DESTINATION = { finId: "02" + "aa".repeat(32) } as any;

const venue = (address: string) => ({ venueAddress: address }) as any;

const OPERATOR_INSTRUCTIONS = [
  "INSTRUCTION_HOLD", "INSTRUCTION_TRANSFER", "INSTRUCTION_RELEASE",
  "INSTRUCTION_ISSUE", "INSTRUCTION_REVERT_HOLD", "INSTRUCTION_REDEEM",
];

describe("onChainCapabilities", () => {
  const cases: Array<[string, string[], string[]]> = [
    ["no venue", [], []],
    ["one venue", [VENUE_A], [VENUE_A]],
    ["two venues keep config order", [VENUE_B, VENUE_A], [VENUE_B, VENUE_A]],
  ];

  test.each(cases)("%s", (_name, venueAddresses, expectedSwapContracts) => {
    const list = onChainCapabilities(OPERATOR, venueAddresses.map(venue));
    const instructions = list.map((c) => c.instruction);

    expect(instructions.slice(0, 6)).toEqual(OPERATOR_INSTRUCTIONS);
    expect(instructions.includes("INSTRUCTION_MOVE")).toBe(false);
    list.slice(0, 6).forEach((c) => {
      expect(c.contracts?.map((x) => x.address)).toEqual([OPERATOR]);
      expect(c.contracts?.[0].name).toBe("FINP2POperator");
      expect(c.contracts?.[0].restrictions).toBeUndefined();
    });
    if (expectedSwapContracts.length === 0) {
      expect(instructions).toHaveLength(6);
    } else {
      expect(instructions).toHaveLength(7);
      const swap = list[6];
      expect(swap.instruction).toBe("INSTRUCTION_SWAP");
      expect(swap.contracts?.map((x) => x.address)).toEqual(expectedSwapContracts);
      expect(swap.contracts?.every((x) => x.name === "AllowanceSwap")).toBe(true);
    }
  });
});

describe("sameAddress", () => {
  const cases: Array<[string, string, boolean]> = [
    [VENUE_A, VENUE_A.toUpperCase().replace("0X", "0x"), true],
    [VENUE_A, OTHER, false],
    ["ABC", "abc", false],
    ["abc", "abc", true],
  ];
  test.each(cases)("%s vs %s", (a, b, expected) => {
    expect(sameAddress(a, b)).toBe(expected);
  });
});

describe("detectSwapVenues", () => {
  test("plural wins and warns about the singular", () => {
    const warnings: string[] = [];
    const venues = detectSwapVenues({
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `${VENUE_A}, ${VENUE_B}`,
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS: OTHER,
    }, (m) => warnings.push(m));

    expect(venues.map((v) => v.venueAddress)).toEqual([VENUE_A, VENUE_B]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is ignored");
  });

  test("falls back to the singular variable", () => {
    const venues = detectSwapVenues({ FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS: VENUE_A });
    expect(venues.map((v) => v.venueAddress)).toEqual([VENUE_A]);
  });

  test("no variable gives an empty list", () => {
    expect(detectSwapVenues({})).toEqual([]);
  });

  const invalid: Array<[string, NodeJS.ProcessEnv, RegExp]> = [
    ["invalid plural entry", { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `${VENUE_A},nope` }, /not an Ethereum address/],
    ["invalid singular", { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS: "nope" }, /not an Ethereum address/],
    ["duplicate in another letter case", {
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `${VENUE_A},${VENUE_A.toUpperCase().replace("0X", "0x")}`,
    }, /Duplicate address/],
  ];
  test.each(invalid)("%s throws", (_name, env, message) => {
    expect(() => detectSwapVenues(env)).toThrow(message);
  });
});

describe("pickVenue", () => {
  const venues = [venue(VENUE_A), venue(VENUE_B)];

  test("no contract picks the first venue", () => {
    expect(pickVenue({ planId: "p", sequence: 1 } as any, venues)).toEqual({ venue: venues[0] });
  });

  test("a listed contract in another letter case picks that venue", () => {
    const requested = "0x" + VENUE_B.slice(2).toUpperCase();
    expect(pickVenue({ planId: "p", sequence: 1, contract: requested } as any, venues)).toEqual({ venue: venues[1] });
  });

  test("an unknown contract is an error naming the address and SWAP", () => {
    const result = pickVenue({ planId: "p", sequence: 1, contract: OTHER } as any, venues);
    expect(result).toEqual({ error: `contract ${OTHER} is not available for SWAP on this adapter` });
  });
});

describe("OnChainTokenService capabilities", () => {
  const contractMock = () => ({
    finP2PContractAddress: OPERATOR,
    getCredentialAddress: jest.fn().mockResolvedValue("0x" + "11".repeat(20)),
    getAssetAddress: jest.fn().mockResolvedValue("0x" + "22".repeat(20)),
    issue: jest.fn(),
  });
  const service = (contract: ReturnType<typeof contractMock>, venues = [venue(VENUE_A)]) =>
    new OnChainTokenService(contract as any, undefined, new InMemoryExecDetailsStore(), undefined, undefined, undefined, venues);

  test("issue with an unknown contract fails and sends no transaction", async () => {
    const contract = contractMock();
    const result = await service(contract).issue("ik", ASSET, DESTINATION, "1", { planId: "p", sequence: 1, contract: OTHER } as any);

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain(`contract ${OTHER} is not available for ISSUE on this adapter`);
    expect(contract.issue).not.toHaveBeenCalled();
  });

  test("getCapabilities lists the operator and the venues", async () => {
    const list = await service(contractMock()).getCapabilities(ASSET);
    expect(list.map((c) => c.instruction)).toContain("INSTRUCTION_SWAP");
  });

  test("getCapabilities on an unknown asset throws status 404", async () => {
    const contract = contractMock();
    contract.getAssetAddress.mockRejectedValue(new Error("execution reverted: Asset not found"));

    await expect(service(contract).getCapabilities(ASSET)).rejects.toMatchObject({ status: 404 });
  });
});
