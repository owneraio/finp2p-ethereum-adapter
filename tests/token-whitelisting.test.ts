import { TokenWhitelistingOption } from "../src/services/direct/token-whitelisting-option";
import { tokenStandardRegistry } from "../src/services/direct/token-standards/registry";
import { supportsWhitelisting, WhitelistParty } from "../src/services/direct/token-standards/whitelisting";
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

type Call = { assetId: string; parties: WhitelistParty[] };

function whitelistingStandard(calls: Call[], failWith?: string) {
  return {
    ensureWhitelisted: async (asset: any, parties: WhitelistParty[]) => {
      calls.push({ assetId: asset.contractAddress, parties });
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

const instruction = (assetId: string, source?: string, destination?: string, local = true, type = "transfer") => ({
  type, organizations: [ORG], local, sourceFinId: source, destinationFinId: destination, assetId
});

const plan = (instructions: any[]): IntrospectedPlan => ({ planId: "plan-1", orgId: ORG, instructions, raw: {} });

describe("TokenWhitelistingOption", () => {

  const calls: Call[] = [];
  beforeAll(() => {
    tokenStandardRegistry.register("WL_TEST", whitelistingStandard(calls));
    tokenStandardRegistry.register("WL_FAILING", whitelistingStandard(calls, "not eligible"));
    tokenStandardRegistry.register("WL_PLAIN", plainStandard);
  });
  beforeEach(() => { calls.length = 0; });

  test("whitelists parties for both assets when both are kept in this adapter", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST", [SETTLEMENT_ID]: "WL_TEST" });
    const veto = await option.apply(plan([
      instruction(SETTLEMENT_ID, ALICE, BOB, true, "hold"),
      instruction(ASSET_ID, BOB, ALICE),
      instruction(SETTLEMENT_ID, ALICE, BOB, true, "release")
    ]));
    expect(veto).toBeUndefined();
    expect(calls).toHaveLength(2);
    const byAsset = Object.fromEntries(calls.map(c => [c.assetId, c.parties]));
    expect(byAsset[`0xtoken-${SETTLEMENT_ID}`].map(p => `${p.finId}:${p.role}`).sort())
      .toEqual([`${ALICE}:source`, `${BOB}:destination`].sort());
    expect(byAsset[`0xtoken-${ASSET_ID}`].map(p => `${p.finId}:${p.role}`).sort())
      .toEqual([`${BOB}:source`, `${ALICE}:destination`].sort());
  });

  test("only the asset kept in this adapter is whitelisted", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" });
    const veto = await option.apply(plan([
      instruction(FOREIGN_ASSET_ID, ALICE, BOB, false),
      instruction(ASSET_ID, BOB, ALICE)
    ]));
    expect(veto).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].assetId).toBe(`0xtoken-${ASSET_ID}`);
  });

  test("parties are deduplicated across instructions of the same asset", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" });
    await option.apply(plan([
      instruction(ASSET_ID, ALICE, BOB),
      instruction(ASSET_ID, ALICE, BOB)
    ]));
    expect(calls).toHaveLength(1);
    expect(calls[0].parties).toHaveLength(2);
  });

  test("standards without the whitelisting capability are skipped", async () => {
    expect(supportsWhitelisting(plainStandard)).toBe(false);
    const option = buildOption({ [ASSET_ID]: "WL_PLAIN" });
    const veto = await option.apply(plan([instruction(ASSET_ID, ALICE, BOB)]));
    expect(veto).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("whitelisting failure vetoes the plan", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_FAILING" });
    const veto = await option.apply(plan([instruction(ASSET_ID, ALICE, BOB)]));
    expect(veto?.type).toBe("rejected");
    expect((veto as any).error.message).toMatch(/not eligible/);
  });

  test("unresolvable party address vetoes the plan", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" }, { [ALICE]: ADDR[ALICE] }); // BOB unmapped
    const veto = await option.apply(plan([instruction(ASSET_ID, ALICE, BOB)]));
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
