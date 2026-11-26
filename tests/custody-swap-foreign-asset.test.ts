import winston from "winston";
import { parseUnits } from "ethers";
import { TokenStandard } from "@owneraio/finp2p-ethereum-adapter-contract";
import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";
import { CustodyTokenService } from "../src/services/custody/token-service";

const A_ADDRESS = "0x" + "11".repeat(20);
const B_ADDRESS = "0x" + "22".repeat(20);
const A_FINID = "02" + "aa".repeat(32);
const B_FINID = "02" + "bb".repeat(32);
const LOCAL_TOKEN = "0x" + "99".repeat(20);
const FOREIGN_TOKEN = "0x" + "77".repeat(20);
const OTHER_FOREIGN_TOKEN = "0x" + "66".repeat(20);

const logger = winston.createLogger({ transports: [new winston.transports.Console({ silent: true })] });
const wallet = (address: string) => ({ signer: { getAddress: async () => address } }) as any;

const decimalsOf = (decimals: number) => ({ decimals: jest.fn().mockResolvedValue(decimals) }) as unknown as TokenStandard & { decimals: jest.Mock };
const erc20 = decimalsOf(6);
const custom = decimalsOf(4);
tokenStandardRegistry.register("ERC20", erc20);
tokenStandardRegistry.register("CUSTODY_FOREIGN_TEST", custom);

const venue = { venueAddress: "0x" + "dd".repeat(20), swap: jest.fn() };
const namedVenue = { name: "Desk", listedAddress: "0x" + "dd".repeat(20), venue: venue as any };

const LOCAL_ID = "bank-us:102:local";
const FOREIGN_ID = "bank-eu:102:foreign";
const getAsset = jest.fn();
const readProvider = { getNetwork: jest.fn().mockResolvedValue({ chainId: 31337n }) } as any;

const service = () => {
  const addresses: Record<string, string> = { [A_FINID]: A_ADDRESS, [B_FINID]: B_ADDRESS };
  return new CustodyTokenService(
    logger,
    { resolveWallet: async (address: string) => wallet(address) } as any,
    undefined, readProvider,
    { resolveAccount: async (finId: string) => addresses[finId] } as any,
    { getAsset, saveAsset: async () => {} } as any,
    undefined, [namedVenue],
  );
};

const leg = (assetId: string, tokenId: string | undefined, standard: string | undefined, from: string, to: string, quantity = "1.5") =>
  ({
    asset: { assetId, assetType: "finp2p", ledgerIdentifier: { assetIdentifierType: "CAIP-19", tokenId, standard } },
    quantity, source: { finId: from }, destination: { finId: to },
  }) as any;

const swap = (svc: CustodyTokenService, asset: any, settlement: any, receipts = 2) =>
  svc.swap("ik", "n", "op", asset, settlement, receipts, 0, undefined) as Promise<any>;

beforeEach(() => {
  jest.clearAllMocks();
  venue.swap.mockResolvedValue({ status: "executed", transactionId: "0xtx", blockNumber: 1, timestamp: 1 });
  getAsset.mockImplementation(async (id: string) =>
    id === LOCAL_ID ? { contract_address: LOCAL_TOKEN, decimals: 2, token_standard: "ERC20" } : undefined);
});

describe("swap leg for an asset this adapter does not know", () => {
  test("uses the leg's token address and reads decimals from chain", async () => {
    const result = await swap(service(),
      leg(LOCAL_ID, LOCAL_TOKEN, "ERC20", A_FINID, B_FINID),
      leg(FOREIGN_ID, FOREIGN_TOKEN, undefined, B_FINID, A_FINID, "2"));

    expect(result.type).toBe("success");
    expect(erc20.decimals).toHaveBeenCalledTimes(1);
    expect(erc20.decimals.mock.calls[0].slice(0, 2)).toEqual([readProvider, FOREIGN_TOKEN]);
    const intent = venue.swap.mock.calls[0][1];
    expect(intent.give).toMatchObject({ token: LOCAL_TOKEN, amount: parseUnits("1.5", 2) });
    expect(intent.take).toMatchObject({ token: FOREIGN_TOKEN, amount: parseUnits("2", 6) });
  });

  test("the one-receipt path resolves the foreign leg the same way", async () => {
    const result = await swap(service(),
      leg(FOREIGN_ID, FOREIGN_TOKEN, undefined, A_FINID, B_FINID, "3"),
      leg(LOCAL_ID, LOCAL_TOKEN, "ERC20", B_FINID, A_FINID), 1);

    expect(result.type).toBe("success");
    expect(venue.swap).toHaveBeenCalledTimes(1);
    expect(venue.swap.mock.calls[0][1].give).toMatchObject({ token: FOREIGN_TOKEN, amount: parseUnits("3", 6) });
  });

  test("a registered standard on the leg decides how decimals are read", async () => {
    await swap(service(),
      leg(FOREIGN_ID, FOREIGN_TOKEN, "CUSTODY_FOREIGN_TEST", A_FINID, B_FINID, "1"),
      leg("bank-eu:102:other", OTHER_FOREIGN_TOKEN, undefined, B_FINID, A_FINID, "1"));

    expect(custom.decimals).toHaveBeenCalledTimes(1);
    expect(erc20.decimals).toHaveBeenCalledTimes(1);
    const intent = venue.swap.mock.calls[0][1];
    expect(intent.give.amount).toBe(parseUnits("1", 4));
    expect(intent.take.amount).toBe(parseUnits("1", 6));
  });

  test("a leg this adapter knows keeps its DB row and makes no chain read", async () => {
    await swap(service(),
      leg(LOCAL_ID, FOREIGN_TOKEN, "CUSTODY_FOREIGN_TEST", A_FINID, B_FINID),
      leg(LOCAL_ID, FOREIGN_TOKEN, "CUSTODY_FOREIGN_TEST", B_FINID, A_FINID));

    expect(erc20.decimals).not.toHaveBeenCalled();
    expect(custom.decimals).not.toHaveBeenCalled();
    expect(venue.swap.mock.calls[0][1].give).toMatchObject({ token: LOCAL_TOKEN, amount: parseUnits("1.5", 2) });
  });

  test.each([
    ["no token address", undefined],
    ["an empty token address", ""],
    ["a token id that is not an address", "eip155:1/erc20:not-an-address"],
  ])("%s fails the swap with a clear message and no venue call", async (_name, tokenId) => {
    const result = await swap(service(),
      leg(LOCAL_ID, LOCAL_TOKEN, "ERC20", A_FINID, B_FINID),
      leg(FOREIGN_ID, tokenId, undefined, B_FINID, A_FINID));

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain(`Asset ${FOREIGN_ID} is not registered in DB and its ledger identifier carries no token address`);
    expect(venue.swap).not.toHaveBeenCalled();
  });

  test("a failed decimals read fails the swap with no venue call", async () => {
    erc20.decimals.mockRejectedValueOnce(new Error("execution reverted"));
    const result = await swap(service(),
      leg(LOCAL_ID, LOCAL_TOKEN, "ERC20", A_FINID, B_FINID),
      leg(FOREIGN_ID, FOREIGN_TOKEN, undefined, B_FINID, A_FINID));

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain("execution reverted");
    expect(venue.swap).not.toHaveBeenCalled();
  });
});

describe("other instructions still require a known asset", () => {
  test("transfer of an unregistered asset fails and reads nothing from chain", async () => {
    const asset = { assetId: FOREIGN_ID, assetType: "finp2p", ledgerIdentifier: { assetIdentifierType: "CAIP-19", tokenId: FOREIGN_TOKEN } } as any;
    const result = await service().transfer("ik", "n", { finId: A_FINID } as any, { finId: B_FINID } as any, asset, "1", undefined as any, undefined) as any;

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain(`Asset ${FOREIGN_ID} is not registered in DB`);
    expect(erc20.decimals).not.toHaveBeenCalled();
  });
});

describe("a leg that throws in a two-leg swap", () => {
  test("fails the swap only after the other leg settled", async () => {
    let finishOther: (value: unknown) => void = () => undefined;
    venue.swap
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockReturnValueOnce(new Promise((resolve) => { finishOther = resolve; }));
    let settled = false;

    const done = swap(service(),
      leg(LOCAL_ID, LOCAL_TOKEN, "ERC20", A_FINID, B_FINID),
      leg(FOREIGN_ID, FOREIGN_TOKEN, undefined, B_FINID, A_FINID)).then((result) => { settled = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    finishOther({ status: "executed", transactionId: "0xtx", blockNumber: 1, timestamp: 1 });
    const result = await done;

    expect(result.type).toBe("failure");
    expect(JSON.stringify(result)).toContain("rpc down");
  });
});
