import { PrimaryType, LegType } from "@owneraio/finp2p-ethereum-token-standard";
import { buildOperationContext } from "../src/services/direct/operation-context";

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
