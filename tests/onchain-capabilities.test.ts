import { AssetNotFoundError } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { OnChainTokenService, InMemoryExecDetailsStore } from "../src/services/onchain";
import { getAddress } from "ethers";
import { contractAddress } from "@owneraio/adapter-tests";
import { onChainCapabilities, operatorContractError, pickVenue, requestedEvmAddress } from "../src/services/onchain/capabilities";
import { detectSwapVenues, venuesFromConfig, VENUE_NAME_PATTERN } from "../src/swap-venues";

jest.mock("../src/nonce-recovery", () => ({
  ...jest.requireActual("../src/nonce-recovery"),
  deployERC20WithRecovery: jest.fn().mockResolvedValue("0x" + "22".repeat(20)),
}));

const OPERATOR = "0x" + "aa".repeat(20);
const VENUE_A = "0x" + "bb".repeat(20);
const VENUE_B = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const OTHER = "0x" + "cc".repeat(20);

const ASSET = { assetId: "bank-us:102:asset-1", assetType: "finp2p" } as any;
const DESTINATION = { finId: "02" + "aa".repeat(32) } as any;

const CHAIN_ID = 31337n;

const venue = (address: string, name = "AllowanceSwap") => ({
  name,
  listedAddress: address,
  venue: { venueAddress: address },
}) as any;

const upper = (address: string) => "0x" + address.slice(2).toUpperCase();
const caip10 = (address: string, chainId: bigint | string = CHAIN_ID, namespace = "eip155") =>
  `${namespace}:${chainId}:${address}`;
const listed = (address: string) => ({ address: caip10(getAddress(address)), addressFormat: "caip10" });

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
      expect(c.contracts).toEqual([listed(OPERATOR)]);
    });
    if (venueAddresses.length === 0) {
      expect(instructions).toHaveLength(6);
    } else {
      expect(instructions).toHaveLength(7);
      expect(list[6].instruction).toBe("INSTRUCTION_SWAP");
      expect(list[6].contracts).toEqual(venueAddresses.map(listed));
    }
  });

  test("a contract is the checksummed CAIP-10 address with no name or description", () => {
    const list = onChainCapabilities(CHAIN_ID, OPERATOR.toLowerCase(), [venue(VENUE_B.toLowerCase(), "AllowanceSwapB")]);
    const swap = list.find((c) => c.instruction === "INSTRUCTION_SWAP")!;

    expect(swap.contracts).toEqual([{ address: `eip155:31337:${VENUE_B}`, addressFormat: "caip10" }]);
    list.flatMap((c) => c.contracts ?? []).forEach((contract) => {
      expect(Object.keys(contract).sort()).toEqual(["address", "addressFormat"]);
    });
  });

  test("every listed address is valid caip10 for the shared adapter tests", () => {
    const list = onChainCapabilities(CHAIN_ID, OPERATOR, [venue(VENUE_A), venue(VENUE_B)]);
    list.flatMap((c) => c.contracts ?? []).forEach(({ address, addressFormat }) => {
      expect(contractAddress.isValidContractAddress(address, addressFormat)).toBe(true);
    });
  });
});

describe("requestedEvmAddress", () => {
  const cases: Array<[string, string, string | undefined]> = [
    ["the listed spelling", caip10(VENUE_B), VENUE_B],
    ["lower case address", caip10(VENUE_B.toLowerCase()), VENUE_B.toLowerCase()],
    ["upper case namespace", caip10(VENUE_B, CHAIN_ID, "EIP155"), VENUE_B],
    ["mixed case namespace", caip10(VENUE_B, CHAIN_ID, "Eip155"), VENUE_B],
    ["the router respelling", contractAddress.respellContractAddress(caip10(VENUE_B), "caip10"), upper(VENUE_B)],
    ["another chain", caip10(VENUE_B, 1n), undefined],
    ["a chain reference with a leading zero", caip10(VENUE_B, "031337"), undefined],
    ["another namespace", caip10(VENUE_B, CHAIN_ID, "solana"), undefined],
    ["a bare 0x address", VENUE_B, undefined],
    ["a short address", caip10("0x1234"), undefined],
    ["a url", `https://example.com/${VENUE_B}`, undefined],
    ["an empty string", "", undefined],
  ];
  test.each(cases)("%s", (_name, requested, expected) => {
    expect(requestedEvmAddress(requested, CHAIN_ID)).toEqual(expected);
  });
});

describe("operatorContractError", () => {
  const ex = (contract?: string) => ({ planId: "p", sequence: 1, contract }) as any;
  const cases: Array<[string, string | undefined, boolean]> = [
    ["no contract", undefined, false],
    ["the listed spelling", caip10(getAddress(OPERATOR)), false],
    ["a respelled address", caip10(upper(OPERATOR), CHAIN_ID, "EIP155"), false],
    ["another contract", caip10(OTHER), true],
    ["the operator on another chain", caip10(OPERATOR, 1n), true],
    ["a bare operator address", OPERATOR, true],
  ];
  test.each(cases)("%s", (_name, contract, refused) => {
    const error = operatorContractError("INSTRUCTION_HOLD", ex(contract), OPERATOR, CHAIN_ID);
    expect(error !== undefined).toBe(refused);
    if (refused) {
      expect(error).toBe(`contract ${contract} is not available for HOLD on this adapter`);
    }
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
  const ex = (contract?: string) => ({ planId: "p", sequence: 1, contract }) as any;

  test("no contract picks the first venue", () => {
    expect(pickVenue(ex(), venues, CHAIN_ID)).toEqual({ venue: venues[0].venue });
  });

  test("a listed contract picks that venue", () => {
    expect(pickVenue(ex(caip10(getAddress(VENUE_B))), venues, CHAIN_ID)).toEqual({ venue: venues[1].venue });
  });

  test("another spelling of a listed contract picks that venue", () => {
    const requested = caip10(upper(VENUE_B), CHAIN_ID, "EIP155");
    expect(pickVenue(ex(requested), venues, CHAIN_ID)).toEqual({ venue: venues[1].venue });
  });

  const refused: Array<[string, string]> = [
    ["an unknown contract", caip10(OTHER)],
    ["a listed address on another chain", caip10(VENUE_A, 1n)],
    ["a bare listed address", VENUE_A],
  ];
  test.each(refused)("%s is an error naming the contract and SWAP", (_name, requested) => {
    expect(pickVenue(ex(requested), venues, CHAIN_ID)).toEqual({ error: `contract ${requested} is not available for SWAP on this adapter` });
  });
});

describe("venuesFromConfig", () => {
  test("a config with a venue list uses it", () => {
    const venues = [venue(VENUE_A, "A"), venue(VENUE_B, "B")];
    expect(venuesFromConfig({ swapVenues: venues })).toBe(venues);
  });

  test("a config with only the single venue lists it under the default name", () => {
    const single = { venueAddress: VENUE_A } as any;
    const venues = venuesFromConfig({ swapVenue: single });
    expect(venues.map((v) => [v.name, v.listedAddress, v.venue])).toEqual([["AllowanceSwap", VENUE_A, single]]);
  });

  test("a single venue with a swap contract of its own is listed under that contract", () => {
    const single = { swapAddress: VENUE_B, venueAddress: VENUE_A } as any;
    const venues = venuesFromConfig({ swapVenue: single });
    expect(venues.map((v) => [v.listedAddress, v.venue])).toEqual([[VENUE_B, single]]);
  });

  test("a config without venues lists none", () => {
    expect(venuesFromConfig({})).toEqual([]);
  });
});

describe("OnChainTokenService capabilities", () => {
  const contractMock = () => ({
    finP2PContractAddress: OPERATOR,
    provider: { getNetwork: jest.fn().mockResolvedValue({ chainId: CHAIN_ID, name: "hardhat" }) },
    variant: "basic",
    getCredentialAddress: jest.fn().mockResolvedValue("0x" + "11".repeat(20)),
    getAssetAddress: jest.fn().mockResolvedValue("0x" + "22".repeat(20)),
    associateAsset: jest.fn().mockResolvedValue("0xhash"),
    issue: jest.fn(),
  });
  const service = (contract: ReturnType<typeof contractMock>, reportCapabilities: boolean, venues = [venue(VENUE_A)]) =>
    new OnChainTokenService(contract as any, undefined, new InMemoryExecDetailsStore(), undefined, undefined, "ERC20", venues, reportCapabilities);
  const create = (svc: OnChainTokenService) =>
    svc.createAsset("ik", ASSET.assetId, { network: "eip155:31337", standard: "ERC20" } as any, undefined, undefined, undefined, undefined);

  test.each([true, false])("issue with an unlisted contract fails and sends no transaction (reporting %s)", async (reporting) => {
    const contract = contractMock();
    const result = await service(contract, reporting).issue("ik", ASSET, DESTINATION, "1", { planId: "p", sequence: 1, contract: caip10(OTHER) } as any);

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain(`contract ${caip10(OTHER)} is not available for ISSUE on this adapter`);
    expect(contract.issue).not.toHaveBeenCalled();
  });

  test("reporting on: create lists the operator and the venues", async () => {
    const created: any = await create(service(contractMock(), true));

    expect(created.type).toBe("success");
    expect(created.result.capabilities.map((c: any) => c.instruction)).toEqual([...OPERATOR_INSTRUCTIONS, "INSTRUCTION_SWAP"]);
    expect(created.result.capabilities[0].contracts).toEqual([listed(OPERATOR)]);
    expect(created.result.capabilities[6].contracts).toEqual([listed(VENUE_A)]);
  });

  test("reporting off: create carries no capabilities", async () => {
    const created: any = await create(service(contractMock(), false));

    expect(created.type).toBe("success");
    expect("capabilities" in created.result).toBe(false);
  });

  test("reporting off: getCapabilities is not implemented, so the route answers 501", () => {
    expect(service(contractMock(), false).getCapabilities).toBeUndefined();
  });

  test("reporting on: getCapabilities lists the operator and the venues", async () => {
    const svc = service(contractMock(), true);
    const list = await svc.getCapabilities!(ASSET);
    expect(list.map((c) => c.instruction)).toContain("INSTRUCTION_SWAP");
    expect(list[6].contracts).toEqual([listed(VENUE_A)]);
  });

  test("the chain id is read once and a failed read is retried", async () => {
    const contract = contractMock();
    contract.provider.getNetwork.mockRejectedValueOnce(new Error("rpc down"));
    const svc = service(contract, true);

    await expect(svc.getCapabilities!(ASSET)).rejects.toThrow("rpc down");
    await svc.getCapabilities!(ASSET);
    await svc.getCapabilities!(ASSET);
    expect(contract.provider.getNetwork).toHaveBeenCalledTimes(2);
  });

  test("issue through the listed operator contract in another spelling reaches the ledger", async () => {
    const contract = contractMock();
    contract.issue.mockResolvedValue({ hash: "0xhash" });
    const requested = caip10(upper(OPERATOR), CHAIN_ID, "EIP155");

    await service(contract, true).issue("ik", ASSET, DESTINATION, "1", { planId: "p", sequence: 1, contract: requested } as any);

    expect(contract.issue).toHaveBeenCalledTimes(1);
  });

  test("reporting on: getCapabilities on an unknown asset throws AssetNotFoundError", async () => {
    const contract = contractMock();
    contract.getAssetAddress.mockRejectedValue(new Error("execution reverted: Asset not found"));

    const error = await service(contract, true).getCapabilities!(ASSET).catch((e) => e);
    expect(error).toBeInstanceOf(AssetNotFoundError);
    expect(error.message).toContain(`asset ${ASSET.assetId} not found`);
  });

  test("swap with a contract that is not a venue fails before any work", async () => {
    const svc = service(contractMock(), false);
    const result: any = await svc.swap("ik", "n", "op", {} as any, {} as any, 2, 0, { planId: "p", sequence: 1, contract: caip10(OTHER) } as any);

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain(`contract ${caip10(OTHER)} is not available for SWAP on this adapter`);
  });

  test("the default venue is the first configured one", () => {
    const svc = service(contractMock(), false, [venue(VENUE_B, "B"), venue(VENUE_A, "A")]);
    expect(svc.swapVenue).toBe(svc.swapVenues[0].venue);
  });
});
