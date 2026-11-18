import { AssetNotFoundError } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { OnChainTokenService, InMemoryExecDetailsStore } from "../src/services/onchain";
import { onChainCapabilities, pickVenue, sameAddress } from "../src/services/onchain/capabilities";
import { detectSwapVenues, VENUE_NAME_PATTERN } from "../src/swap-venues";

const OPERATOR = "0x" + "aa".repeat(20);
const VENUE_A = "0x" + "bb".repeat(20);
const VENUE_B = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const OTHER = "0x" + "cc".repeat(20);

const ASSET = { assetId: "bank-us:102:asset-1", assetType: "finp2p" } as any;
const DESTINATION = { finId: "02" + "aa".repeat(32) } as any;

const venue = (address: string, name = "AllowanceSwap") => ({
  name,
  description: "Settles both legs in one transaction from approved allowances",
  venue: { venueAddress: address },
}) as any;

const upper = (address: string) => "0x" + address.slice(2).toUpperCase();

const OPERATOR_INSTRUCTIONS = [
  "INSTRUCTION_HOLD", "INSTRUCTION_TRANSFER", "INSTRUCTION_RELEASE",
  "INSTRUCTION_ISSUE", "INSTRUCTION_REVERT_HOLD", "INSTRUCTION_REDEEM",
];

describe("onChainCapabilities", () => {
  const cases: Array<[string, Array<[string, string]>]> = [
    ["no venue", []],
    ["one venue", [["AllowanceSwap", VENUE_A]]],
    ["two venues keep config order and configured names", [["AllowanceSwapB", VENUE_B], ["AllowanceSwapA", VENUE_A]]],
  ];

  test.each(cases)("%s", (_name, venueConfig) => {
    const list = onChainCapabilities(OPERATOR, venueConfig.map(([name, address]) => venue(address, name)));
    const instructions = list.map((c) => c.instruction);

    expect(instructions.slice(0, 6)).toEqual(OPERATOR_INSTRUCTIONS);
    expect(instructions.includes("INSTRUCTION_MOVE")).toBe(false);
    list.slice(0, 6).forEach((c) => {
      expect(c.contracts?.map((x) => x.address)).toEqual([OPERATOR]);
      expect(c.contracts?.map((x) => x.name)).toEqual(["FINP2POperator"]);
      expect(c.contracts?.[0].restrictions).toBeUndefined();
    });
    if (venueConfig.length === 0) {
      expect(instructions).toHaveLength(6);
    } else {
      expect(instructions).toHaveLength(7);
      const swap = list[6];
      expect(swap.instruction).toBe("INSTRUCTION_SWAP");
      expect(swap.contracts?.map((x) => [x.name, x.address])).toEqual(venueConfig);
      expect(swap.contracts?.every((x) => x.description !== undefined)).toBe(true);
    }
  });

  test("every listed contract carries a name valid for the router", () => {
    const list = onChainCapabilities(OPERATOR, [venue(VENUE_A, "AllowanceSwapA"), venue(VENUE_B, "AllowanceSwapB")]);
    list.flatMap((c) => c.contracts ?? []).forEach((contract) => {
      expect(contract.name).toMatch(VENUE_NAME_PATTERN);
    });
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
  const view = (env: NodeJS.ProcessEnv) =>
    detectSwapVenues(env).map((v) => [v.name, v.venue.venueAddress]);

  test("plural wins and warns about the singular", () => {
    const warnings: string[] = [];
    const venues = detectSwapVenues({
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `${VENUE_A}, ${VENUE_B}`,
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS: OTHER,
    }, (m) => warnings.push(m));

    expect(venues.map((v) => v.venue.venueAddress)).toEqual([VENUE_A, VENUE_B]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is ignored");
  });

  const naming: Array<[string, NodeJS.ProcessEnv, string[][]]> = [
    ["singular variable gets the default name", { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS: VENUE_A }, [["AllowanceSwap", VENUE_A]]],
    ["one unnamed plural entry gets the default name", { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: VENUE_A }, [["AllowanceSwap", VENUE_A]]],
    ["one named plural entry", { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `AllowanceSwapA=${VENUE_A}` }, [["AllowanceSwapA", VENUE_A]]],
    ["named entries keep config order", {
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `AllowanceSwapA=${VENUE_A}, AllowanceSwapB=${VENUE_B}`,
    }, [["AllowanceSwapA", VENUE_A], ["AllowanceSwapB", VENUE_B]]],
    ["several unnamed entries derive the name from the address", {
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `${VENUE_A},${VENUE_B}`,
    }, [["AllowanceSwap-bbbbbbbb", VENUE_A], ["AllowanceSwap-a51c1fc2", VENUE_B]]],
    ["a derived name ignores the address letter case and the order", {
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `${upper(VENUE_B)},${VENUE_A}`,
    }, [["AllowanceSwap-a51c1fc2", upper(VENUE_B)], ["AllowanceSwap-bbbbbbbb", VENUE_A]]],
    ["named and unnamed entries mix", {
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `Permit2Swap=${VENUE_A},${VENUE_B}`,
    }, [["Permit2Swap", VENUE_A], ["AllowanceSwap-a51c1fc2", VENUE_B]]],
    ["no variable gives an empty list", {}, []],
  ];
  test.each(naming)("%s", (_name, env, expected) => {
    expect(view(env)).toEqual(expected);
  });

  const invalid: Array<[string, NodeJS.ProcessEnv, RegExp]> = [
    ["invalid plural entry", { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `${VENUE_A},nope` }, /not an Ethereum address/],
    ["invalid address after a name", { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: "AllowanceSwapA=nope" }, /not an Ethereum address/],
    ["invalid singular", { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS: "nope" }, /not an Ethereum address/],
    ["empty name", { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `=${VENUE_A}` }, /Invalid venue name/],
    ["name with a space", { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `Allowance Swap=${VENUE_A}` }, /Invalid venue name/],
    ["name over 64 characters", { FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `${"a".repeat(65)}=${VENUE_A}` }, /Invalid venue name/],
    ["duplicate address in another letter case", {
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `A=${VENUE_A},B=${upper(VENUE_A)}`,
    }, /Duplicate address/],
    ["duplicate name", {
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `Same=${VENUE_A},Same=${VENUE_B}`,
    }, /Duplicate venue name/],
  ];
  test.each(invalid)("%s throws", (_name, env, message) => {
    expect(() => detectSwapVenues(env)).toThrow(message);
  });
});

describe("pickVenue", () => {
  const venues = [venue(VENUE_A), venue(VENUE_B)];

  test("no contract picks the first venue", () => {
    expect(pickVenue({ planId: "p", sequence: 1 } as any, venues)).toEqual({ venue: venues[0].venue });
  });

  test("a listed contract in another letter case picks that venue", () => {
    const requested = upper(VENUE_B);
    expect(pickVenue({ planId: "p", sequence: 1, contract: requested } as any, venues)).toEqual({ venue: venues[1].venue });
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

  test("getCapabilities on an unknown asset throws AssetNotFoundError", async () => {
    const contract = contractMock();
    contract.getAssetAddress.mockRejectedValue(new Error("execution reverted: Asset not found"));

    const error = await service(contract).getCapabilities(ASSET).catch((e) => e);
    expect(error).toBeInstanceOf(AssetNotFoundError);
    expect(error.message).toContain(`asset ${ASSET.assetId} not found`);
  });
});
