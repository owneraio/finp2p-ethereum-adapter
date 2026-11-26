import winston from "winston";
import { getAddress } from "ethers";
import { TokenStandard } from "@owneraio/finp2p-ethereum-adapter-contract";
import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";
import { CustodyTokenService } from "../src/services/custody/token-service";
import { NamedSwapVenue, detectSwapVenues } from "../src/swap-venues";

const ESCROW_ADDRESS = "0x" + "ee".repeat(20);
const A_ADDRESS = "0x" + "11".repeat(20);
const B_ADDRESS = "0x" + "22".repeat(20);
const A_FINID = "02" + "aa".repeat(32);
const B_FINID = "02" + "bb".repeat(32);
const VENUE_ADDRESS = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const OTHER_ADDRESS = "0x" + "cc".repeat(20);
const CHAIN_ID = 31337n;

const logger = winston.createLogger({ transports: [new winston.transports.Console({ silent: true })] });
const wallet = (address: string) => ({ signer: { getAddress: async () => address } }) as any;
const ok = { status: "success", transactionId: "0xtx", timestamp: 1 } as const;

const standard = {
  mint: jest.fn().mockResolvedValue(ok),
  transfer: jest.fn().mockResolvedValue(ok),
  burn: jest.fn().mockResolvedValue(ok),
  hold: jest.fn().mockResolvedValue(ok),
  release: jest.fn().mockResolvedValue(ok),
} as unknown as TokenStandard & Record<"mint" | "transfer" | "burn" | "hold" | "release", jest.Mock>;
tokenStandardRegistry.register("CUSTODY_CONTRACT_TEST", standard);

const caip10 = (address: string, chainId: bigint | string = CHAIN_ID, namespace = "eip155") =>
  `${namespace}:${chainId}:${address}`;
const upper = (address: string) => "0x" + address.slice(2).toUpperCase();

const venue = { venueAddress: "0x" + "dd".repeat(20), swap: jest.fn().mockResolvedValue(ok) };
const namedVenue = { name: "Desk", listedAddress: VENUE_ADDRESS, venue: venue as any };

const getAsset = jest.fn().mockResolvedValue({ contract_address: "0x" + "99".repeat(20), decimals: 2, token_standard: "CUSTODY_CONTRACT_TEST" });
const getNetwork = jest.fn().mockResolvedValue({ chainId: CHAIN_ID });

function service(swapVenue?: typeof namedVenue | NamedSwapVenue[]): CustodyTokenService {
  const addresses: Record<string, string> = { [A_FINID]: A_ADDRESS, [B_FINID]: B_ADDRESS };
  const accountMapping = { resolveAccount: async (finId: string) => addresses[finId] } as any;
  const custodyProvider = {
    resolveWallet: async (address: string) => (Object.values(addresses).includes(address) ? wallet(address) : undefined),
  } as any;
  return new CustodyTokenService(
    logger, custodyProvider, wallet(ESCROW_ADDRESS), { getNetwork } as any, accountMapping,
    { getAsset, saveAsset: async () => {} } as any, wallet(ESCROW_ADDRESS),
    Array.isArray(swapVenue) ? swapVenue : swapVenue ? [swapVenue] : [],
  );
}

const ASSET = { assetId: "bank-us:102:asset-1", assetType: "finp2p" } as any;
const SOURCE = { finId: A_FINID } as any;
const DESTINATION = { finId: B_FINID } as any;
const SIGNATURE = undefined as any;
const exCtx = (contract?: string) => ({ planId: "p", sequence: 1, ...(contract === undefined ? {} : { contract }) }) as any;
const REQUESTED = caip10(OTHER_ADDRESS);

const leg = (assetId: string, from: string, to: string) =>
  ({ asset: { assetId, assetType: "finp2p" }, quantity: "1", source: { finId: from }, destination: { finId: to } }) as any;
const swap = (svc: CustodyTokenService, ctx: any, receipts = 2) =>
  svc.swap("ik", "n", "op", leg("a:1", A_FINID, B_FINID), leg("s:1", B_FINID, A_FINID), receipts, 0, ctx) as Promise<any>;

beforeEach(() => jest.clearAllMocks());

describe("CustodyTokenService refuses a requested contract before any chain call", () => {
  const instructions: Array<[string, (svc: CustodyTokenService, ctx: any) => Promise<any>]> = [
    ["HOLD", (svc, ctx) => svc.hold("ik", "n", SOURCE, DESTINATION, ASSET, "1", SIGNATURE, "op", ctx)],
    ["TRANSFER", (svc, ctx) => svc.transfer("ik", "n", SOURCE, DESTINATION, ASSET, "1", SIGNATURE, ctx)],
    ["RELEASE", (svc, ctx) => svc.release("ik", SOURCE, DESTINATION, ASSET, "1", "op", ctx)],
    ["ISSUE", (svc, ctx) => svc.issue("ik", ASSET, DESTINATION, "1", ctx)],
    ["REVERT_HOLD", (svc, ctx) => svc.rollback("ik", SOURCE, ASSET, "1", "op", ctx)],
    ["REDEEM", (svc, ctx) => svc.redeem("ik", "n", SOURCE, ASSET, "1", "op", SIGNATURE, ctx)],
    ["SWAP", (svc, ctx) => swap(svc, ctx)],
  ];

  test.each(instructions)("%s with a contract fails with the contract named", async (name, run) => {
    const result = await run(service(namedVenue), exCtx(REQUESTED));

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain(`contract ${REQUESTED} is not available for ${name} on this adapter`);
    expect(getAsset).not.toHaveBeenCalled();
    expect(venue.swap).not.toHaveBeenCalled();
    for (const fn of Object.values(standard)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  test.each(instructions.filter(([name]) => name !== "SWAP"))("%s makes no chain read when it refuses", async (_name, run) => {
    await run(service(), exCtx(REQUESTED));

    expect(getNetwork).not.toHaveBeenCalled();
  });

  test.each([
    ["TRANSFER", (svc: CustodyTokenService, ctx: any) => svc.transfer("ik", "n", SOURCE, DESTINATION, ASSET, "1", SIGNATURE, ctx), "transfer"],
    ["ISSUE", (svc: CustodyTokenService, ctx: any) => svc.issue("ik", ASSET, DESTINATION, "1", ctx), "mint"],
  ])("%s without a contract runs the default", async (_name, run, method) => {
    const result = await run(service(), exCtx());

    expect(result.type).toBe("success");
    expect(standard[method as "mint" | "transfer"]).toHaveBeenCalledTimes(1);
  });
});

describe("CustodyTokenService swap contract", () => {
  test("the service's own venue address in any spelling runs the swap", async () => {
    for (const requested of [caip10(getAddress(VENUE_ADDRESS)), caip10(upper(VENUE_ADDRESS), CHAIN_ID, "EIP155")]) {
      venue.swap.mockClear();
      const result = await swap(service(namedVenue), exCtx(requested));

      expect(result.type).toBe("success");
      expect(venue.swap).toHaveBeenCalledTimes(2);
    }
  });

  test("the venue address on another chain is refused", async () => {
    const requested = caip10(VENUE_ADDRESS, 1n);
    const result = await swap(service(namedVenue), exCtx(requested));

    expect(JSON.stringify(result)).toContain(`contract ${requested} is not available for SWAP on this adapter`);
    expect(venue.swap).not.toHaveBeenCalled();
  });

  test("a bare 0x venue address is refused", async () => {
    const result = await swap(service(namedVenue), exCtx(VENUE_ADDRESS));

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain(`contract ${VENUE_ADDRESS} is not available for SWAP on this adapter`);
  });

  test("the venue's own address also runs a one-receipt swap past the contract check", async () => {
    const result = await swap(service(namedVenue), exCtx(caip10(VENUE_ADDRESS)), 1);

    expect(result.type).toBe("success");
    expect(venue.swap).toHaveBeenCalledTimes(1);
  });

  test("with no venue configured a requested contract is refused without a chain read", async () => {
    const result = await swap(service(), exCtx(caip10(VENUE_ADDRESS)));

    expect(JSON.stringify(result)).toContain("is not available for SWAP on this adapter");
    expect(getNetwork).not.toHaveBeenCalled();
  });

  test("a swap without a contract runs on the configured venue", async () => {
    const result = await swap(service(namedVenue), exCtx());

    expect(result.type).toBe("success");
    expect(venue.swap).toHaveBeenCalledTimes(2);
  });
});

describe("CustodyTokenService with several swap venues", () => {
  const ALLOWANCE_A = "0x" + "a1".repeat(20);
  const ALLOWANCE_B = "0x" + "b2".repeat(20);
  const PERMIT2_SWAP = "0x" + "c3".repeat(20);

  const venues = () => {
    const list = detectSwapVenues({
      FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: `${ALLOWANCE_A},${ALLOWANCE_B}`,
      FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: PERMIT2_SWAP,
    });
    const swaps = list.map((entry) => jest.spyOn(entry.venue, "swap").mockResolvedValue({ status: "executed", transactionId: "0xtx", blockNumber: 1, timestamp: 1 }));
    return { list, swaps };
  };
  const called = (swaps: jest.SpyInstance[]) => swaps.map((spy) => spy.mock.calls.length);

  test.each([
    ["the first allowance venue", ALLOWANCE_A, [2, 0, 0]],
    ["the second allowance venue", ALLOWANCE_B, [0, 2, 0]],
    ["the Permit2 venue by its Permit2Swap address", PERMIT2_SWAP, [0, 0, 2]],
  ])("a two-receipt swap naming %s runs only that venue", async (_name, address, expected) => {
    const { list, swaps } = venues();
    const result = await swap(service(list), exCtx(caip10(getAddress(address))));

    expect(result.type).toBe("success");
    expect(called(swaps)).toEqual(expected);
  });

  test.each([
    ["the first allowance venue", ALLOWANCE_A, [1, 0, 0]],
    ["the second allowance venue", ALLOWANCE_B, [0, 1, 0]],
    ["the Permit2 venue", PERMIT2_SWAP, [0, 0, 1]],
  ])("a one-receipt swap naming %s runs only that venue", async (_name, address, expected) => {
    const { list, swaps } = venues();
    const result = await swap(service(list), exCtx(caip10(getAddress(address))), 1);

    expect(result.type).toBe("success");
    expect(called(swaps)).toEqual(expected);
  });

  test.each([1, 2])("a swap with no contract runs the first venue (%s receipts)", async (receipts) => {
    const { list, swaps } = venues();
    const result = await swap(service(list), exCtx(), receipts);

    expect(result.type).toBe("success");
    expect(called(swaps)).toEqual([receipts, 0, 0]);
  });

  test.each([1, 2])("a contract matching no venue fails with no chain call (%s receipts)", async (receipts) => {
    const { list, swaps } = venues();
    const requested = caip10(OTHER_ADDRESS);
    const result = await swap(service(list), exCtx(requested), receipts);

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain(`contract ${requested} is not available for SWAP on this adapter`);
    expect(called(swaps)).toEqual([0, 0, 0]);
    expect(getAsset).not.toHaveBeenCalled();
  });

  test("the Permit2 contract itself is not a venue", async () => {
    const { list, swaps } = venues();
    const result = await swap(service(list), exCtx(caip10("0x000000000022D473030F116dDEE9F6B43aC78BA3")));

    expect(result.type).toBe("failure");
    expect(called(swaps)).toEqual([0, 0, 0]);
  });

  test("non-swap instructions still refuse a contract even when it names a venue", async () => {
    const { list } = venues();
    const result = await service(list).transfer("ik", "n", SOURCE, DESTINATION, ASSET, "1", SIGNATURE, exCtx(caip10(ALLOWANCE_A)));

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain("is not available for TRANSFER on this adapter");
    expect(standard.transfer).not.toHaveBeenCalled();
  });
});
