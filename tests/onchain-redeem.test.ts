import { OnChainTokenService, InMemoryExecDetailsStore } from "../src/services/onchain";

const INVESTOR_FINID = "02" + "aa".repeat(32);
const TX_HASH = "0x" + "ab".repeat(32);

const ASSET = { assetId: "bank-us:102:asset-1", assetType: "finp2p" } as any;
const SOURCE = { finId: INVESTOR_FINID } as any;
const EX_CTX = { planId: "bank-us:106:plan-1", sequence: 3 } as any;
const NO_SIGNATURE = undefined as any;

const txReceipt = { hash: TX_HASH } as any;

const contractReceipt = (operationId?: string) => ({
  type: "success",
  receipt: {
    id: TX_HASH,
    asset: { assetId: ASSET.assetId, assetType: "finp2p" },
    quantity: "1.0",
    source: { finId: INVESTOR_FINID },
    operationType: "redeem",
    operationId,
    tradeDetails: { executionContext: { planId: "", sequence: 0 } },
  },
});

function contractMock() {
  return {
    getCredentialAddress: jest.fn().mockResolvedValue("0x" + "11".repeat(20)),
    releaseAndRedeem: jest.fn().mockResolvedValue(txReceipt),
    redeem: jest.fn().mockResolvedValue(txReceipt),
    getReceiptFromTransactionReceipt: jest.fn(),
  };
}

function service(contract: ReturnType<typeof contractMock>) {
  const store = new InMemoryExecDetailsStore();
  return { store, svc: new OnChainTokenService(contract as any, undefined, store, undefined, undefined) };
}

describe("OnChainTokenService.redeem", () => {

  test("with operationId releases the held asset leg and redeems from escrow", async () => {
    const contract = contractMock();
    contract.getReceiptFromTransactionReceipt.mockResolvedValue(contractReceipt("op-1"));
    const { svc, store } = service(contract);

    const receipt = await svc.redeem("ik", "nonce", SOURCE, ASSET, "1.0", "op-1", NO_SIGNATURE, EX_CTX);

    expect(receipt.type).toBe("success");
    expect(contract.redeem).not.toHaveBeenCalled();
    expect(contract.releaseAndRedeem).toHaveBeenCalledTimes(1);
    const [operationId, ownerFinId, quantity] = contract.releaseAndRedeem.mock.calls[0];
    expect(operationId).toBe("op-1");
    expect(ownerFinId).toBe(INVESTOR_FINID);
    expect(quantity).toBe("1.0");
    expect(contract.getReceiptFromTransactionReceipt).toHaveBeenCalledWith(txReceipt);
    expect(store.getExecutionContext(TX_HASH)).toEqual({ planId: EX_CTX.planId, sequence: EX_CTX.sequence });
    expect((receipt as any).receipt.tradeDetails.executionContext).toEqual(EX_CTX);
  });

  test("without operationId redeems directly from the investor balance (no prior hold on this asset)", async () => {
    const contract = contractMock();
    contract.getReceiptFromTransactionReceipt.mockResolvedValue(contractReceipt());
    const { svc, store } = service(contract);

    const receipt = await svc.redeem("ik", "nonce", SOURCE, ASSET, "1.0", undefined, NO_SIGNATURE, EX_CTX);

    expect(receipt.type).toBe("success");
    expect(contract.releaseAndRedeem).not.toHaveBeenCalled();
    expect(contract.redeem).toHaveBeenCalledTimes(1);
    const [ownerFinId, term] = contract.redeem.mock.calls[0];
    expect(ownerFinId).toBe(INVESTOR_FINID);
    expect(term).toMatchObject({ assetId: ASSET.assetId, amount: "1.0" });
    expect(contract.getReceiptFromTransactionReceipt).toHaveBeenCalledWith(txReceipt);
    expect(store.getExecutionContext(TX_HASH)).toEqual({ planId: EX_CTX.planId, sequence: EX_CTX.sequence });
    expect((receipt as any).receipt.tradeDetails.executionContext).toEqual(EX_CTX);
  });

  test("empty-string operationId is treated as absent", async () => {
    const contract = contractMock();
    contract.getReceiptFromTransactionReceipt.mockResolvedValue(contractReceipt());
    const { svc } = service(contract);

    const receipt = await svc.redeem("ik", "nonce", SOURCE, ASSET, "1.0", "", NO_SIGNATURE, EX_CTX);

    expect(receipt.type).toBe("success");
    expect(contract.releaseAndRedeem).not.toHaveBeenCalled();
    expect(contract.redeem).toHaveBeenCalledTimes(1);
  });

  test("contract failure maps to a failed receipt operation", async () => {
    const contract = contractMock();
    contract.redeem.mockRejectedValue(new Error("execution reverted"));
    const { svc } = service(contract);

    const receipt = await svc.redeem("ik", "nonce", SOURCE, ASSET, "1.0", undefined, NO_SIGNATURE, EX_CTX);

    expect(receipt.type).toBe("failure");
    expect((receipt as any).error.message).toContain("execution reverted");
  });
});
