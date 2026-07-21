import { TokenWhitelistingOption } from "../src/services/direct/token-whitelisting-option";
import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";
import { supportsWhitelisting, WhitelistParty } from "@owneraio/finp2p-ethereum-adapter-contract";
import { IntrospectedPlan } from "../src/services/plan-approval";

const ORG = "bank-us";
const ASSET_ID = `${ORG}:102:asset-1`;
const SETTLEMENT_ID = `${ORG}:102:cash-1`;
const FOREIGN_ASSET_ID = "bank-uk:102:asset-9";

const ALICE = "02" + "aa".repeat(32);
const BOB = "03" + "bb".repeat(32);
const ADDR: Record<string, string> = {
  [ALICE]: "0x1111111111111111111111111111111111111111",
  [BOB]: "0x2222222222222222222222222222222222222222"
};
const EXPLICIT_ADDR = "0x3333333333333333333333333333333333333333";

// ensureWhitelisted is called once per investor; record each (asset, finId, role).
type Call = { assetId: string; finId?: string; address: string; role: string };

function whitelistingStandard(calls: Call[], failWith?: string) {
  return {
    ensureWhitelisted: async (asset: any, parties: WhitelistParty[]) => {
      for (const p of parties) calls.push({ assetId: asset.contractAddress, finId: p.finId, address: p.address, role: p.role });
      return failWith ? { status: "failure", reason: failWith } : { status: "success", transactionId: "tx", timestamp: 0 };
    }
  } as any;
}

const plainStandard = {} as any;

function buildOption(assets: Record<string, string>, mapped: Record<string, string> = ADDR) {
  const assetStore = {
    getAsset: async (id: string) => assets[id]
      ? { contract_address: `0xtoken-${id}`, decimals: 2, token_standard: assets[id], id }
      : undefined
  } as any;
  const accountMapping = { resolveAccount: async (finId: string) => mapped[finId] } as any;
  return new TokenWhitelistingOption(assetStore, accountMapping);
}

const instruction = (
  assetId: string, source?: string, destination?: string, local = true, type = "transfer",
  addresses: { sourceAddress?: string; destinationAddress?: string } = {}
) => ({
  type, organizations: [ORG], local, sourceFinId: source, destinationFinId: destination, assetId, ...addresses
});

const plan = (instructions: any[]): IntrospectedPlan => ({ planId: "plan-1", orgId: ORG, instructions, raw: {} });

const keys = (calls: Call[]) => calls.map(c => `${c.assetId}|${c.finId}|${c.role}`).sort();

describe("TokenWhitelistingOption", () => {

  const calls: Call[] = [];
  beforeAll(() => {
    tokenStandardRegistry.register("WL_TEST", whitelistingStandard(calls));
    tokenStandardRegistry.register("WL_FAILING", whitelistingStandard(calls, "not eligible"));
    tokenStandardRegistry.register("WL_PLAIN", plainStandard);
  });
  beforeEach(() => { calls.length = 0; });

  test("whitelists the source and destination of each asset kept in this adapter", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST", [SETTLEMENT_ID]: "WL_TEST" });
    const veto = await option.apply(plan([
      instruction(SETTLEMENT_ID, ALICE, BOB, true, "hold"),
      instruction(ASSET_ID, BOB, ALICE),
    ]));
    expect(veto).toBeUndefined();
    expect(keys(calls)).toEqual([
      `0xtoken-${SETTLEMENT_ID}|${ALICE}|source`,
      `0xtoken-${SETTLEMENT_ID}|${BOB}|destination`,
      `0xtoken-${ASSET_ID}|${BOB}|source`,
      `0xtoken-${ASSET_ID}|${ALICE}|destination`,
    ].sort());
  });

  test("a finId-less endpoint (escrow/external) is never whitelisted", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" });
    const veto = await option.apply(plan([instruction(ASSET_ID, ALICE, undefined, true, "hold")]));
    expect(veto).toBeUndefined();
    expect(keys(calls)).toEqual([`0xtoken-${ASSET_ID}|${ALICE}|source`]);
  });

  test("only assets kept in this adapter are whitelisted", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" });
    const veto = await option.apply(plan([
      instruction(FOREIGN_ASSET_ID, ALICE, BOB, false),
      instruction(ASSET_ID, BOB, ALICE)
    ]));
    expect(veto).toBeUndefined();
    expect(calls.every(c => c.assetId === `0xtoken-${ASSET_ID}`)).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("standards without the whitelisting capability are skipped", async () => {
    expect(supportsWhitelisting(plainStandard)).toBe(false);
    const option = buildOption({ [ASSET_ID]: "WL_PLAIN" }, {}); // nothing mapped at all
    const veto = await option.apply(plan([instruction(ASSET_ID, ALICE, BOB)]));
    expect(veto).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("an explicit ledger address is used for a transfer destination when the finId is unmapped", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" }, { [ALICE]: ADDR[ALICE] }); // BOB unmapped
    const veto = await option.apply(plan([
      instruction(ASSET_ID, ALICE, BOB, true, "transfer", { destinationAddress: EXPLICIT_ADDR })
    ]));
    expect(veto).toBeUndefined();
    const dest = calls.find(c => c.role === "destination");
    expect(dest?.address).toBe(EXPLICIT_ADDR);
    expect(dest?.finId).toBe(BOB);
  });

  test("an explicit address is not accepted for a source — execution needs a mapped custody wallet", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" }, { [BOB]: ADDR[BOB] }); // ALICE (source) unmapped
    const veto = await option.apply(plan([
      instruction(ASSET_ID, ALICE, BOB, true, "transfer", { sourceAddress: EXPLICIT_ADDR })
    ]));
    expect(veto?.type).toBe("rejected");
    expect((veto as any).error.message).toMatch(/cannot resolve address for source/);
  });

  test("an explicit address is not accepted for an issue destination — execution resolves the finId via mapping only", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" }, {}); // BOB unmapped
    const veto = await option.apply(plan([
      instruction(ASSET_ID, undefined, BOB, true, "issue", { destinationAddress: EXPLICIT_ADDR })
    ]));
    expect(veto?.type).toBe("rejected");
    expect((veto as any).error.message).toMatch(/cannot resolve address for destination/);
  });

  test("a finId-less destination carrying a network address is not whitelisted", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" });
    const veto = await option.apply(plan([
      instruction(ASSET_ID, ALICE, undefined, true, "transfer", { destinationAddress: EXPLICIT_ADDR })
    ]));
    expect(veto).toBeUndefined();
    expect(keys(calls)).toEqual([`0xtoken-${ASSET_ID}|${ALICE}|source`]);
  });

  test("whitelisting failure vetoes the plan", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_FAILING" });
    const veto = await option.apply(plan([instruction(ASSET_ID, ALICE, BOB)]));
    expect(veto?.type).toBe("rejected");
    expect((veto as any).error.message).toMatch(/not eligible/);
  });

  test("an unresolvable source vetoes the plan before any whitelisting call", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" }, { [ALICE]: ADDR[ALICE] }); // BOB (source) unmapped
    const veto = await option.apply(plan([instruction(ASSET_ID, BOB, ALICE)]));
    expect(veto?.type).toBe("rejected");
    expect((veto as any).error.message).toMatch(/cannot resolve address/);
    expect(calls).toHaveLength(0);
  });

  test("unregistered token standard vetoes the plan", async () => {
    const option = buildOption({ [ASSET_ID]: "NOT_REGISTERED_ANYWHERE" });
    const veto = await option.apply(plan([instruction(ASSET_ID, ALICE, BOB)]));
    expect(veto?.type).toBe("rejected");
    expect((veto as any).error.message).toMatch(/is not registered/);
  });

  test("assets absent from the store and non-local instructions are ignored", async () => {
    const option = buildOption({});
    const veto = await option.apply(plan([
      instruction(ASSET_ID, ALICE, BOB),
      instruction(FOREIGN_ASSET_ID, ALICE, BOB, false)
    ]));
    expect(veto).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
