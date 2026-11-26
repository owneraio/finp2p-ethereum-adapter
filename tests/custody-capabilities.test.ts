import winston from "winston";
import { getAddress } from "ethers";
import { AssetNotFoundError } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { TokenStandard } from "@owneraio/finp2p-ethereum-adapter-contract";
import { contractAddress } from "@owneraio/adapter-tests";
import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";
import { CustodyTokenService } from "../src/services/custody/token-service";
import { custodyCapabilities, onChainCapabilities } from "../src/services/onchain/capabilities";
import { detectSwapVenues } from "../src/swap-venues";
import { envVarsToAppConfig } from "../src/config";

jest.mock("@owneraio/finp2p-client", () => ({ FinP2PClient: class {} }));

const CHAIN_ID = 31337n;
const VENUE_A = "0x" + "a1".repeat(20);
const VENUE_B = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const PERMIT2_SWAP = "0x" + "c3".repeat(20);
const TOKEN = "0x" + "99".repeat(20);

const logger = winston.createLogger({ transports: [new winston.transports.Console({ silent: true })] });
const wallet = (address: string) => ({ signer: { getAddress: async () => address } }) as any;

const standard = {
  decimals: jest.fn().mockResolvedValue(6),
  deploy: jest.fn().mockResolvedValue({ contractAddress: TOKEN, decimals: 6, tokenStandard: "CUSTODY_CAPS_TEST" }),
} as unknown as TokenStandard;
tokenStandardRegistry.register("CUSTODY_CAPS_TEST", standard);

const venue = (address: string, name = "AllowanceSwap") => ({ name, listedAddress: address, venue: { venueAddress: address } }) as any;
const listed = (address: string) => ({ address: `eip155:${CHAIN_ID}:${getAddress(address)}`, addressFormat: "caip10" });
const names = (list: Array<{ instruction: string }>) => list.map((c) => c.instruction);

const ALWAYS = ["INSTRUCTION_TRANSFER", "INSTRUCTION_REDEEM"];
const ISSUER_ROW = ["INSTRUCTION_ISSUE"];
const ESCROW_ROWS = ["INSTRUCTION_HOLD", "INSTRUCTION_RELEASE", "INSTRUCTION_REVERT_HOLD"];

describe("custodyCapabilities", () => {
  const cases: Array<[string, { issuer: boolean; escrow: boolean }, string[]]> = [
    ["no issuer, no escrow", { issuer: false, escrow: false }, ALWAYS],
    ["issuer only", { issuer: true, escrow: false }, [...ALWAYS, ...ISSUER_ROW]],
    ["escrow only", { issuer: false, escrow: true }, [...ALWAYS, ...ESCROW_ROWS]],
    ["issuer and escrow", { issuer: true, escrow: true }, [...ALWAYS, ...ISSUER_ROW, ...ESCROW_ROWS]],
  ];

  test.each(cases)("%s lists the matching instructions and no contracts", (_name, wallets, expected) => {
    const list = custodyCapabilities(CHAIN_ID, wallets, []);

    expect(names(list).sort()).toEqual([...expected].sort());
    list.forEach((c) => expect(c.contracts).toBeUndefined());
  });

  test("SWAP appears only with a venue and lists every venue in order", () => {
    const withVenues = custodyCapabilities(CHAIN_ID, { issuer: true, escrow: true }, [venue(VENUE_B), venue(VENUE_A)]);
    const swap = withVenues.filter((c) => c.instruction === "INSTRUCTION_SWAP");

    expect(swap).toEqual([{ instruction: "INSTRUCTION_SWAP", contracts: [listed(VENUE_B), listed(VENUE_A)] }]);
    expect(names(custodyCapabilities(CHAIN_ID, { issuer: true, escrow: true }, []))).not.toContain("INSTRUCTION_SWAP");
  });

  test("the SWAP row is the one the operator mode builds", () => {
    const venues = [venue(VENUE_A), venue(VENUE_B.toLowerCase())];
    const custodySwap = custodyCapabilities(CHAIN_ID, { issuer: false, escrow: false }, venues).find((c) => c.instruction === "INSTRUCTION_SWAP");
    const operatorSwap = onChainCapabilities(CHAIN_ID, "0x" + "aa".repeat(20), venues).find((c) => c.instruction === "INSTRUCTION_SWAP");

    expect(custodySwap).toEqual(operatorSwap);
    custodySwap!.contracts!.forEach(({ address, addressFormat }) => {
      expect(contractAddress.isValidContractAddress(address, addressFormat)).toBe(true);
    });
  });

  test("Permit2 venues are listed by their Permit2Swap address", () => {
    const venues = detectSwapVenues({ FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESSES: VENUE_A, FINP2P_ETHEREUM_PERMIT2_SWAP_ADDRESSES: PERMIT2_SWAP });
    const swap = custodyCapabilities(CHAIN_ID, { issuer: false, escrow: false }, venues).find((c) => c.instruction === "INSTRUCTION_SWAP")!;

    expect(swap.contracts).toEqual([listed(VENUE_A), listed(PERMIT2_SWAP)]);
  });
});

describe("CustodyTokenService capability reporting", () => {
  const getAsset = jest.fn();
  const saveAsset = jest.fn().mockResolvedValue(undefined);
  const getNetwork = jest.fn().mockResolvedValue({ chainId: CHAIN_ID });
  const ASSET = { assetId: "bank-us:102:asset-1", assetType: "finp2p" } as any;

  const service = (flag: boolean, opts: { issuer?: boolean; escrow?: boolean; venues?: any[] } = {}) =>
    new CustodyTokenService(
      logger, {} as any, opts.escrow ? wallet("0x" + "ee".repeat(20)) : undefined, { getNetwork } as any, {} as any,
      { getAsset, saveAsset } as any, opts.issuer ? wallet("0x" + "11".repeat(20)) : undefined, opts.venues ?? [], flag,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    getAsset.mockResolvedValue({ contract_address: TOKEN, decimals: 6, token_standard: "CUSTODY_CAPS_TEST" });
  });

  test("with the flag off there is no getCapabilities and creation reports no list", async () => {
    const svc = service(false, { issuer: true, escrow: true, venues: [venue(VENUE_A)] });
    const bound = await svc.createAsset("ik", ASSET.assetId, { tokenId: TOKEN, standard: "CUSTODY_CAPS_TEST" }, undefined, undefined, undefined, undefined) as any;

    expect(svc.getCapabilities).toBeUndefined();
    expect(bound.type).toBe("success");
    expect("capabilities" in bound.result).toBe(false);
  });

  test("with the flag on getCapabilities answers per configuration", async () => {
    const full = await service(true, { issuer: true, escrow: true, venues: [venue(VENUE_A), venue(VENUE_B)] }).getCapabilities!(ASSET);
    const bare = await service(true).getCapabilities!(ASSET);

    expect(names(full).sort()).toEqual([...ALWAYS, ...ISSUER_ROW, ...ESCROW_ROWS, "INSTRUCTION_SWAP"].sort());
    expect(full.find((c) => c.instruction === "INSTRUCTION_SWAP")!.contracts).toEqual([listed(VENUE_A), listed(VENUE_B)]);
    expect(names(bare).sort()).toEqual([...ALWAYS].sort());
  });

  test("an unknown asset is an AssetNotFoundError", async () => {
    getAsset.mockResolvedValue(undefined);

    await expect(service(true).getCapabilities!(ASSET)).rejects.toBeInstanceOf(AssetNotFoundError);
    await expect(service(true).getCapabilities!(ASSET)).rejects.toThrow(`asset ${ASSET.assetId} not found`);
  });

  test("creating by binding a token returns the list when the flag is on", async () => {
    const svc = service(true, { issuer: false, escrow: true, venues: [venue(VENUE_A)] });
    const result = await svc.createAsset("ik", ASSET.assetId, { tokenId: TOKEN, standard: "CUSTODY_CAPS_TEST" }, undefined, undefined, undefined, undefined) as any;

    expect(result.type).toBe("success");
    expect(names(result.result.capabilities).sort()).toEqual([...ALWAYS, ...ESCROW_ROWS, "INSTRUCTION_SWAP"].sort());
  });

  test("creating by deploying a token returns the list when the flag is on", async () => {
    const svc = service(true, { issuer: true });
    const result = await svc.createAsset("ik", ASSET.assetId, { standard: "CUSTODY_CAPS_TEST" }, undefined, undefined, undefined, undefined) as any;

    expect(result.type).toBe("success");
    expect(names(result.result.capabilities).sort()).toEqual([...ALWAYS, ...ISSUER_ROW].sort());
  });
});

describe("ASSET_CAPABILITIES_ENABLED reaches a custody provider's config", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const flagged = (value: string | undefined) => {
    process.env.PROVIDER_TYPE = "local";
    if (value === undefined) delete process.env.ASSET_CAPABILITIES_ENABLED;
    else process.env.ASSET_CAPABILITIES_ENABLED = value;
    return envVarsToAppConfig({ info: () => undefined, warning: () => undefined } as any);
  };

  test.each([["true", true], ["false", false], [undefined, false]])("flag %s gives reportCapabilities %s", async (value, expected) => {
    expect((await flagged(value)).reportCapabilities).toBe(expected);
  });
});
