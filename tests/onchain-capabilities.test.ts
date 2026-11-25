import { getAddress } from "ethers";
import { AssetNotFoundError } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { OnChainTokenService, InMemoryExecDetailsStore } from "../src/services/onchain";
import { isRequestedContract, onChainCapabilities, operatorContractError, pickVenue, requestedEvmAddress } from "../src/services/onchain/capabilities";
import { detectSwapVenues } from "../src/swap-venues";

const CHAIN_ID = 11155111n;
const OPERATOR = "0x" + "aa".repeat(20);
const VENUE_A = "0x" + "bb".repeat(20);
const VENUE_B = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const OTHER = "0x" + "cc".repeat(20);

const ASSET = { assetId: "bank-us:102:asset-1", assetType: "finp2p" } as any;
const DESTINATION = { finId: "02" + "aa".repeat(32) } as any;

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const PERMIT2_SWAP_A = "0x" + "dd".repeat(20);
const PERMIT2_SWAP_B = "0x" + "ee".repeat(20);

const venue = (address: string, name = "AllowanceSwap", entryPoint = address) => ({
  name,
  description: "Settles both legs in one transaction from approved allowances",
  listedAddress: address,
  venue: { venueAddress: entryPoint },
}) as any;

const upper = (address: string) => "0x" + address.slice(2).toUpperCase();
const caip10 = (address: string, chainId: bigint = CHAIN_ID) => `eip155:${chainId}:${getAddress(address)}`;

const OPERATOR_INSTRUCTIONS = [
  "INSTRUCTION_HOLD", "INSTRUCTION_TRANSFER", "INSTRUCTION_RELEASE",
  "INSTRUCTION_ISSUE", "INSTRUCTION_REVERT_HOLD", "INSTRUCTION_REDEEM",
];

describe("onChainCapabilities", () => {
  const cases: Array<[string, string[]]> = [
    ["no venue", []],
    ["one venue", [VENUE_A]],
    ["two venues keep config order", [VENUE_B, VENUE_A]],
  ];

  test.each(cases)("%s", (_name, venueAddresses) => {
    const list = onChainCapabilities(CHAIN_ID, OPERATOR, venueAddresses.map((address) => venue(address)));
    const instructions = list.map((c) => c.instruction);

    expect(instructions.slice(0, 6)).toEqual(OPERATOR_INSTRUCTIONS);
    expect(instructions.includes("INSTRUCTION_MOVE")).toBe(false);
    list.slice(0, 6).forEach((c) => {
      expect(c.contracts).toEqual([{ address: caip10(OPERATOR), addressFormat: "caip10" }]);
    });
    if (venueAddresses.length === 0) {
      expect(instructions).toHaveLength(6);
    } else {
      expect(instructions).toHaveLength(7);
      const swap = list[6];
      expect(swap.instruction).toBe("INSTRUCTION_SWAP");
      expect(swap.contracts).toEqual(venueAddresses.map((address) => ({ address: caip10(address), addressFormat: "caip10" })));
    }
  });

  test("a Permit2 venue is listed by its Permit2Swap contract, not by Permit2", () => {
    const list = onChainCapabilities(CHAIN_ID, OPERATOR, [
      venue(VENUE_A, "AllowanceSwap"),
      venue(PERMIT2_SWAP_A, "Permit2Swap", PERMIT2),
    ]);
    const swap = list.find((c) => c.instruction === "INSTRUCTION_SWAP");
    expect(swap?.contracts?.map((x) => x.address)).toEqual([caip10(VENUE_A), caip10(PERMIT2_SWAP_A)]);
  });

  test("the chain id goes into the address and the address is checksummed", () => {
    const list = onChainCapabilities(1n, upper(OPERATOR), []);
    expect(list[0].contracts).toEqual([{ address: `eip155:1:${getAddress(OPERATOR)}`, addressFormat: "caip10" }]);
  });

  test("a listed contract has no name or description and no surrounding spaces", () => {
    const list = onChainCapabilities(CHAIN_ID, OPERATOR, [venue(VENUE_A, "AllowanceSwapA"), venue(VENUE_B, "AllowanceSwapB")]);
    list.flatMap((c) => c.contracts ?? []).forEach((contract) => {
      expect(Object.keys(contract).sort()).toEqual(["address", "addressFormat"]);
      expect(contract.address).toMatch(/^eip155:11155111:0x[0-9a-fA-F]{40}$/);
    });
  });
});

describe("requestedEvmAddress", () => {
  const cases: Array<[string, string, string | undefined]> = [
    ["a CAIP-10 id on this chain", caip10(VENUE_A), getAddress(VENUE_A)],
    ["a CAIP-10 id in lower case", `eip155:${CHAIN_ID}:${VENUE_A}`, VENUE_A],
    ["a bare address", VENUE_A, VENUE_A],
    ["another chain", caip10(VENUE_A, 1n), undefined],
    ["a chain id with leading zeros", `eip155:0${CHAIN_ID}:${VENUE_A}`, undefined],
    ["another namespace", `solana:${CHAIN_ID}:${VENUE_A}`, undefined],
    ["a missing chain", `eip155::${VENUE_A}`, undefined],
    ["a short address", `eip155:${CHAIN_ID}:0x1234`, undefined],
    ["a non-hex address", `eip155:${CHAIN_ID}:0x${"zz".repeat(20)}`, undefined],
    ["surrounding spaces", ` ${caip10(VENUE_A)} `, undefined],
    ["a service identifier", "custody-api", undefined],
    ["a url", "https://custody.example/api", undefined],
  ];
  test.each(cases)("%s", (_name, requested, expected) => {
    expect(requestedEvmAddress(requested, CHAIN_ID)).toBe(expected);
  });
});

describe("isRequestedContract", () => {
  const cases: Array<[string, string, boolean]> = [
    ["the same CAIP-10 contract", caip10(VENUE_A), true],
    ["the same contract in another letter case", `eip155:${CHAIN_ID}:${upper(VENUE_A)}`, true],
    ["a bare address", VENUE_A, true],
    ["another contract", caip10(OTHER), false],
    ["the same contract on another chain", caip10(VENUE_A, 1n), false],
    ["a service identifier", "custody-api", false],
  ];
  test.each(cases)("%s", (_name, requested, expected) => {
    expect(isRequestedContract(requested, CHAIN_ID, VENUE_A)).toBe(expected);
  });
});

describe("operatorContractError", () => {
  const ctx = (contract?: string) => ({ planId: "p", sequence: 1, ...(contract !== undefined ? { contract } : {}) }) as any;

  const accepted: Array<[string, string | undefined]> = [
    ["no contract", undefined],
    ["the operator as CAIP-10", caip10(OPERATOR)],
    ["the operator in another letter case", `eip155:${CHAIN_ID}:${upper(OPERATOR)}`],
  ];
  test.each(accepted)("accepts %s", (_name, contract) => {
    expect(operatorContractError("INSTRUCTION_HOLD", ctx(contract), OPERATOR, CHAIN_ID)).toBeUndefined();
  });

  const refused: Array<[string, string]> = [
    ["an unknown address", caip10(OTHER)],
    ["the operator on another chain", caip10(OPERATOR, 1n)],
    ["an unparsable contract", "custody-api"],
  ];
  test.each(refused)("refuses %s", (_name, contract) => {
    expect(operatorContractError("INSTRUCTION_HOLD", ctx(contract), OPERATOR, CHAIN_ID))
      .toBe(`contract ${contract} is not available for HOLD on this adapter`);
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

describe("detectSwapVenues with Permit2 venues", () => {
  const view = (env: NodeJS.ProcessEnv) =>
    detectSwapVenues(env).map((v) => [v.name, v.listedAddress, v.venue.venueAddress]);

  const cases: Array<[string, NodeJS.ProcessEnv, string[][]]> = [
    ["a named Permit2 entry uses the canonical Permit2 as entry point", {
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: `Permit2Swap=${PERMIT2_SWAP_A}`,
    }, [["Permit2Swap", PERMIT2_SWAP_A, PERMIT2]]],
    ["an unnamed Permit2 entry gets the default name", {
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: PERMIT2_SWAP_A,
    }, [["Permit2Swap", PERMIT2_SWAP_A, PERMIT2]]],
    ["several unnamed Permit2 entries derive the name from the address", {
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: `${PERMIT2_SWAP_A},${PERMIT2_SWAP_B}`,
    }, [["Permit2Swap-dddddddd", PERMIT2_SWAP_A, PERMIT2], ["Permit2Swap-eeeeeeee", PERMIT2_SWAP_B, PERMIT2]]],
    ["the Permit2 address can be overridden", {
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: `Permit2Swap=${PERMIT2_SWAP_A}`,
      FINP2P_ETHEREUM_PERMIT2_ADDRESS: OTHER,
    }, [["Permit2Swap", PERMIT2_SWAP_A, OTHER]]],
    ["the Permit2 address alone configures nothing", { FINP2P_ETHEREUM_PERMIT2_ADDRESS: OTHER }, []],
    ["allowance venues come first, then Permit2 venues, whatever the variable order", {
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: `Permit2Swap=${PERMIT2_SWAP_A}`,
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `AllowanceSwapA=${VENUE_A},AllowanceSwapB=${VENUE_B}`,
    }, [
      ["AllowanceSwapA", VENUE_A, VENUE_A],
      ["AllowanceSwapB", VENUE_B, VENUE_B],
      ["Permit2Swap", PERMIT2_SWAP_A, PERMIT2],
    ]],
    ["the singular allowance variable also precedes Permit2 venues", {
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS: VENUE_A,
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: `Permit2Swap=${PERMIT2_SWAP_A}`,
    }, [["AllowanceSwap", VENUE_A, VENUE_A], ["Permit2Swap", PERMIT2_SWAP_A, PERMIT2]]],
  ];
  test.each(cases)("%s", (_name, env, expected) => {
    expect(view(env)).toEqual(expected);
  });

  const invalid: Array<[string, NodeJS.ProcessEnv, RegExp]> = [
    ["a name used in both lists", {
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `Same=${VENUE_A}`,
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: `Same=${PERMIT2_SWAP_A}`,
    }, /Duplicate venue name across swap venue lists: 'Same'/],
    ["an address used in both lists", {
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `A=${VENUE_A}`,
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: `B=${upper(VENUE_A)}`,
    }, /Duplicate address across swap venue lists/],
    ["a duplicate name inside the Permit2 list", {
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: `Same=${PERMIT2_SWAP_A},Same=${PERMIT2_SWAP_B}`,
    }, /Duplicate venue name in FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES/],
    ["an invalid Permit2 swap address", {
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: "Permit2Swap=nope",
    }, /Invalid FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES/],
    ["an invalid Permit2 address", {
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: `Permit2Swap=${PERMIT2_SWAP_A}`,
      FINP2P_ETHEREUM_PERMIT2_ADDRESS: "nope",
    }, /Invalid FINP2P_ETHEREUM_PERMIT2_ADDRESS/],
    ["an invalid Permit2 venue name", {
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: `Permit2 Swap=${PERMIT2_SWAP_A}`,
    }, /Invalid venue name/],
  ];
  test.each(invalid)("%s throws", (_name, env, message) => {
    expect(() => detectSwapVenues(env)).toThrow(message);
  });
});

describe("pickVenue", () => {
  const venues = [venue(VENUE_A), venue(VENUE_B)];
  const ctx = (contract?: string) => ({ planId: "p", sequence: 1, ...(contract !== undefined ? { contract } : {}) }) as any;

  test("no contract picks the first venue", () => {
    expect(pickVenue(ctx(), venues, CHAIN_ID)).toEqual({ venue: venues[0].venue });
  });

  test("a listed CAIP-10 contract picks that venue", () => {
    expect(pickVenue(ctx(caip10(VENUE_B)), venues, CHAIN_ID)).toEqual({ venue: venues[1].venue });
  });

  test("a listed contract in another letter case picks that venue", () => {
    expect(pickVenue(ctx(`eip155:${CHAIN_ID}:${upper(VENUE_B)}`), venues, CHAIN_ID)).toEqual({ venue: venues[1].venue });
  });

  test("two Permit2 venues sharing one entry point are told apart by their listed contract", () => {
    const permit2Venues = [venue(PERMIT2_SWAP_A, "Permit2SwapA", PERMIT2), venue(PERMIT2_SWAP_B, "Permit2SwapB", PERMIT2)];
    expect(pickVenue(ctx(caip10(PERMIT2_SWAP_B)), permit2Venues, CHAIN_ID)).toEqual({ venue: permit2Venues[1].venue });
  });

  test("the Permit2 entry point is not a listed contract", () => {
    const permit2Venues = [venue(PERMIT2_SWAP_A, "Permit2Swap", PERMIT2)];
    expect(pickVenue(ctx(caip10(PERMIT2)), permit2Venues, CHAIN_ID))
      .toEqual({ error: `contract ${caip10(PERMIT2)} is not available for SWAP on this adapter` });
  });

  const refused: Array<[string, string]> = [
    ["an unknown address", caip10(OTHER)],
    ["a listed address on another chain", caip10(VENUE_A, 1n)],
    ["another namespace", `solana:${CHAIN_ID}:${VENUE_A}`],
    ["an unparsable contract", "custody-api"],
  ];
  test.each(refused)("refuses %s with an error naming the contract and SWAP", (_name, contract) => {
    expect(pickVenue(ctx(contract), venues, CHAIN_ID))
      .toEqual({ error: `contract ${contract} is not available for SWAP on this adapter` });
  });
});

describe("OnChainTokenService capabilities", () => {
  const contractMock = () => ({
    finP2PContractAddress: OPERATOR,
    provider: { getNetwork: jest.fn().mockResolvedValue({ chainId: CHAIN_ID, name: "sepolia" }) },
    getCredentialAddress: jest.fn().mockResolvedValue("0x" + "11".repeat(20)),
    getAssetAddress: jest.fn().mockResolvedValue("0x" + "22".repeat(20)),
    issue: jest.fn(),
  });
  const service = (contract: ReturnType<typeof contractMock>, venues = [venue(VENUE_A)]) =>
    new OnChainTokenService(contract as any, undefined, new InMemoryExecDetailsStore(), undefined, undefined, undefined, venues);

  test("issue with an unknown contract fails and sends no transaction", async () => {
    const contract = contractMock();
    const result = await service(contract).issue("ik", ASSET, DESTINATION, "1", { planId: "p", sequence: 1, contract: caip10(OTHER) } as any);

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain(`contract ${caip10(OTHER)} is not available for ISSUE on this adapter`);
    expect(contract.issue).not.toHaveBeenCalled();
  });

  test("getCapabilities lists the operator and the venues as CAIP-10 contracts", async () => {
    const list = await service(contractMock()).getCapabilities(ASSET);
    expect(list.map((c) => c.instruction)).toContain("INSTRUCTION_SWAP");
    expect(list.find((c) => c.instruction === "INSTRUCTION_HOLD")?.contracts)
      .toEqual([{ address: caip10(OPERATOR), addressFormat: "caip10" }]);
    expect(list.find((c) => c.instruction === "INSTRUCTION_SWAP")?.contracts)
      .toEqual([{ address: caip10(VENUE_A), addressFormat: "caip10" }]);
  });

  test("the chain id is read from the provider once", async () => {
    const contract = contractMock();
    const svc = service(contract);
    await svc.getCapabilities(ASSET);
    await svc.getCapabilities(ASSET);
    await svc.issue("ik", ASSET, DESTINATION, "1", { planId: "p", sequence: 1, contract: caip10(OTHER) } as any);
    expect(contract.provider.getNetwork).toHaveBeenCalledTimes(1);
  });

  test("a failed chain id read is retried on the next call", async () => {
    const contract = contractMock();
    contract.provider.getNetwork.mockRejectedValueOnce(new Error("rpc down"));
    const svc = service(contract);
    await expect(svc.getCapabilities(ASSET)).rejects.toThrow("rpc down");
    await expect(svc.getCapabilities(ASSET)).resolves.toBeDefined();
    expect(contract.provider.getNetwork).toHaveBeenCalledTimes(2);
  });

  test("issue on the operator contract goes through", async () => {
    const contract = contractMock();
    contract.issue.mockRejectedValue(new Error("stop here"));
    await service(contract).issue("ik", ASSET, DESTINATION, "1", { planId: "p", sequence: 1, contract: caip10(OPERATOR) } as any);
    expect(contract.issue).toHaveBeenCalledTimes(1);
  });

  test("issue naming the operator on another chain fails and sends no transaction", async () => {
    const contract = contractMock();
    const result = await service(contract).issue("ik", ASSET, DESTINATION, "1", { planId: "p", sequence: 1, contract: caip10(OPERATOR, 1n) } as any);
    expect(result.type).toBe("failure");
    expect(contract.issue).not.toHaveBeenCalled();
  });

  test("getCapabilities on an unknown asset throws AssetNotFoundError", async () => {
    const contract = contractMock();
    contract.getAssetAddress.mockRejectedValue(new Error("execution reverted: Asset not found"));

    const error = await service(contract).getCapabilities(ASSET).catch((e) => e);
    expect(error).toBeInstanceOf(AssetNotFoundError);
    expect(error.message).toContain(`asset ${ASSET.assetId} not found`);
  });
});
