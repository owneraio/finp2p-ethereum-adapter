import { TokenWhitelistingOption } from "../src/services/direct/token-whitelisting-option";
import { tokenStandardRegistry } from "../src/integrations/token-standards";
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
const ESCROW_ADDR = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const EXPLICIT_ADDR = "0x3333333333333333333333333333333333333333";

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

const escrowProvider = (address?: string) => ({
  escrow: { signer: address ? { getAddress: async () => address } : {} }
}) as any;

function buildOption(
  assets: Record<string, string>, mapped: Record<string, string> = ADDR,
  custodyProvider = escrowProvider(ESCROW_ADDR)
) {
  const assetStore = {
    getAsset: async (id: string) => assets[id]
      ? { contract_address: `0xtoken-${id}`, decimals: 2, token_standard: assets[id], id }
      : undefined
  } as any;
  const accountMapping = { resolveAccount: async (finId: string) => mapped[finId] } as any;
  return new TokenWhitelistingOption(assetStore, accountMapping, custodyProvider);
}

const instruction = (
  assetId: string, source?: string, destination?: string, local = true, type = "transfer",
  addresses: { sourceAddress?: string; destinationAddress?: string } = {}
) => ({
  type, organizations: [ORG], local, sourceFinId: source, destinationFinId: destination, assetId, ...addresses
});

const plan = (instructions: any[]): IntrospectedPlan => ({ planId: "plan-1", orgId: ORG, instructions, raw: {} });

const partyKeys = (parties: WhitelistParty[]) => parties.map(p => `${p.finId ?? p.address}:${p.role}`).sort();

describe("TokenWhitelistingOption", () => {

  const calls: Call[] = [];
  beforeAll(() => {
    tokenStandardRegistry.register("WL_TEST", whitelistingStandard(calls));
    tokenStandardRegistry.register("WL_FAILING", whitelistingStandard(calls, "not eligible"));
    tokenStandardRegistry.register("WL_PLAIN", plainStandard);
  });
  beforeEach(() => { calls.length = 0; });

  test("whitelists the transfer endpoints of both assets when both are kept in this adapter", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST", [SETTLEMENT_ID]: "WL_TEST" });
    const veto = await option.apply(plan([
      instruction(SETTLEMENT_ID, ALICE, BOB, true, "hold"),
      instruction(ASSET_ID, BOB, ALICE),
      instruction(SETTLEMENT_ID, ALICE, BOB, true, "release")
    ]));
    expect(veto).toBeUndefined();
    expect(calls).toHaveLength(2);
    const byAsset = Object.fromEntries(calls.map(c => [c.assetId, c.parties]));
    // hold moves ALICE → escrow, release moves escrow → BOB
    expect(partyKeys(byAsset[`0xtoken-${SETTLEMENT_ID}`]))
      .toEqual([`${ALICE}:source`, `${BOB}:destination`, `${ESCROW_ADDR}:escrow`].sort());
    expect(partyKeys(byAsset[`0xtoken-${ASSET_ID}`]))
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

  test("a hold's business destination is not a transfer endpoint — no veto when it is unmapped", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" }, { [ALICE]: ADDR[ALICE] }); // BOB unmapped
    const veto = await option.apply(plan([instruction(ASSET_ID, ALICE, BOB, true, "hold")]));
    expect(veto).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(partyKeys(calls[0].parties)).toEqual([`${ALICE}:source`, `${ESCROW_ADDR}:escrow`].sort());
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

  test("standards without the whitelisting capability are skipped before any party resolution", async () => {
    expect(supportsWhitelisting(plainStandard)).toBe(false);
    const option = buildOption({ [ASSET_ID]: "WL_PLAIN" }, {}); // nothing mapped at all
    const veto = await option.apply(plan([instruction(ASSET_ID, ALICE, BOB, true, "hold")]));
    expect(veto).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("an explicit ledger address is used when the finId is unmapped, like execution", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" }, { [ALICE]: ADDR[ALICE] }); // BOB unmapped
    const veto = await option.apply(plan([
      instruction(ASSET_ID, ALICE, BOB, true, "transfer", { destinationAddress: EXPLICIT_ADDR })
    ]));
    expect(veto).toBeUndefined();
    expect(calls).toHaveLength(1);
    const destination = calls[0].parties.find(p => p.role === "destination");
    expect(destination?.address).toBe(EXPLICIT_ADDR);
    expect(destination?.finId).toBe(BOB);
  });

  test("an escrow wallet without a resolvable address vetoes a plan that needs the escrow endpoint", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" }, ADDR, escrowProvider(undefined));
    const veto = await option.apply(plan([instruction(ASSET_ID, ALICE, BOB, true, "hold")]));
    expect(veto?.type).toBe("rejected");
    expect((veto as any).error.message).toMatch(/escrow wallet address is unavailable/);
    expect(calls).toHaveLength(0);
  });

  test("a plan without escrow endpoints is unaffected by an unresolvable escrow wallet", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" }, ADDR, escrowProvider(undefined));
    const veto = await option.apply(plan([instruction(ASSET_ID, ALICE, BOB)]));
    expect(veto).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test("an explicit address is not accepted for a source — execution needs a mapped custody wallet", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" }, { [BOB]: ADDR[BOB] }); // ALICE unmapped
    const veto = await option.apply(plan([
      instruction(ASSET_ID, ALICE, BOB, true, "transfer", { sourceAddress: EXPLICIT_ADDR })
    ]));
    expect(veto?.type).toBe("rejected");
    expect((veto as any).error.message).toMatch(/cannot resolve address for source/);
    expect(calls).toHaveLength(0);
  });

  test("an explicit address is not accepted for an issue destination — execution resolves it via mapping only", async () => {
    const option = buildOption({ [ASSET_ID]: "WL_TEST" }, {}); // BOB unmapped
    const veto = await option.apply(plan([
      instruction(ASSET_ID, undefined, BOB, true, "issue", { destinationAddress: EXPLICIT_ADDR })
    ]));
    expect(veto?.type).toBe("rejected");
    expect((veto as any).error.message).toMatch(/cannot resolve address for destination/);
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
