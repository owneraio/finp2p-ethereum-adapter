import { PrimaryType, LegType, ReleaseType } from "@owneraio/finp2p-ethereum-adapter-contract";
import { buildOperationContext, deriveReleaseType } from "../src/services/operations/operation-context";

const ASSET = { assetId: "bank-us:102:asset-1", assetType: "finp2p" } as any;
const EXEC_CTX = { planId: "bank-us:106:plan-1", sequence: 1 } as any;

const eip712 = (primaryType: string, message: any) => ({
  template: { type: "EIP712", primaryType, message }
}) as any;

describe("buildOperationContext primaryType mapping (direct mode)", () => {

  test("Move template maps to PrimaryType.Move, not Transfer", () => {
    const ctx = buildOperationContext(
      ASSET,
      eip712("Move", { asset: { assetId: ASSET.assetId, amount: "10" } }),
      EXEC_CTX
    );
    expect(ctx?.primaryType).toBe(PrimaryType.Move);
    expect(ctx?.primaryType).not.toBe(PrimaryType.Transfer);
  });

  test.each([
    ["PrimarySale", PrimaryType.PrimarySale],
    ["Buying", PrimaryType.Buying],
    ["Selling", PrimaryType.Selling],
    ["Redemption", PrimaryType.Redemption],
    ["Transfer", PrimaryType.Transfer],
    ["PrivateOffer", PrimaryType.PrivateOffer],
    ["Loan", PrimaryType.Loan],
    ["Move", PrimaryType.Move]
  ])("maps %s → %s", (templateType, expected) => {
    const ctx = buildOperationContext(
      ASSET, eip712(templateType, { asset: { assetId: ASSET.assetId, amount: "10" } }), EXEC_CTX);
    expect(ctx?.primaryType).toBe(expected);
  });

  test("detects the asset leg for a Move template", () => {
    const ctx = buildOperationContext(
      ASSET, eip712("Move", { asset: { assetId: ASSET.assetId, amount: "10" } }), EXEC_CTX);
    expect(ctx?.leg).toBe(LegType.Asset);
  });

  test("returns undefined without an execution context", () => {
    expect(buildOperationContext(ASSET, eip712("Move", {}), undefined)).toBeUndefined();
  });
});

describe("deriveReleaseType (hold disposition)", () => {

  const DEST = { finId: "02" + "aa".repeat(32) } as any;

  test("Transfer/Redemption intents without a destination investor end in a burn", () => {
    expect(deriveReleaseType(eip712("Transfer", {}), undefined)).toBe(ReleaseType.Redeem);
    expect(deriveReleaseType(eip712("Redemption", {}), undefined)).toBe(ReleaseType.Redeem);
    expect(deriveReleaseType(undefined, undefined)).toBe(ReleaseType.Redeem);
  });

  test("a destination investor means a plain release", () => {
    expect(deriveReleaseType(eip712("Transfer", {}), DEST)).toBe(ReleaseType.Release);
    expect(deriveReleaseType(eip712("Redemption", {}), DEST)).toBe(ReleaseType.Release);
    expect(deriveReleaseType(undefined, DEST)).toBe(ReleaseType.Release);
  });

  test("sale/buy intents always release, destination or not", () => {
    expect(deriveReleaseType(eip712("Selling", {}), undefined)).toBe(ReleaseType.Release);
    expect(deriveReleaseType(eip712("Buying", {}), undefined)).toBe(ReleaseType.Release);
    expect(deriveReleaseType(eip712("PrimarySale", {}), undefined)).toBe(ReleaseType.Release);
  });

  test("buildOperationContext threads the caller-supplied release type", () => {
    const ctx = buildOperationContext(ASSET, eip712("Transfer", {}), { planId: "p", sequence: 1 } as any, "op-1", ReleaseType.Redeem);
    expect(ctx?.releaseType).toBe(ReleaseType.Redeem);
    expect(ctx?.operationId).toBe("op-1");
  });
});
