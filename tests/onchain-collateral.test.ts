import { Asset, ExecutionContext, Signature } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { Phase, successfulTokenOp, TokenOperationResult } from "@owneraio/finp2p-ethereum-adapter-contract";
import { OnChainTokenService } from "../src/services/onchain/token-service";
import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";

const COLLATERAL_STANDARD = "OWNERA_COLLATERAL_REGISTRY";
const AGREEMENT_ID = "0xE92EaD9B0000000000000000000000000000AbCd";
const BORROWER_ADDR = "0x1111111111111111111111111111111111111111";
const LENDER_ADDR = "0x2222222222222222222222222222222222222222";

const collateralAsset: Asset = {
  assetId: "csd:102:2d1a6aca-test",
  assetType: "finp2p",
  ledgerIdentifier: { assetIdentifierType: "CAIP-19", tokenId: AGREEMENT_ID, standard: COLLATERAL_STANDARD },
};

const signature: Signature = { signature: "0x", template: { type: "hashList", hashGroups: [], hash: "" } as any, hashFunc: "keccak-256" } as any;
const exCtx: ExecutionContext = { planId: "plan-1", sequence: 4 };

function fakeContract() {
  const denied = () => { throw new Error("operator contract must not be called for collateral"); };
  return {
    provider: {} as any,
    signer: {} as any,
    getCredentialAddress: jest.fn(async (finId: string) => (finId === "borrower-finid" ? BORROWER_ADDR : LENDER_ADDR)),
    hold: denied, releaseTo: denied, releaseBack: denied, transfer: denied, balance: denied,
  } as any;
}

function fakeStandard(result: TokenOperationResult = successfulTokenOp("synthetic-tx", 1700000000)) {
  return {
    deploy: jest.fn(), decimals: jest.fn(), mint: jest.fn(),
    balanceOf: jest.fn(async (..._args: any[]) => "1"),
    transfer: jest.fn(async (..._args: any[]) => ({ status: "failure", reason: "Collateral asset is not transferable at the token-standard layer" } as TokenOperationResult)),
    burn: jest.fn(),
    hold: jest.fn(async (..._args: any[]) => result),
    release: jest.fn(async (..._args: any[]) => result),
  };
}

describe("OnChainTokenService collateral-registry override", () => {
  let impl: ReturnType<typeof fakeStandard>;
  let service: OnChainTokenService;
  let contract: any;

  beforeEach(() => {
    tokenStandardRegistry.reset();
    impl = fakeStandard();
    tokenStandardRegistry.register(COLLATERAL_STANDARD, impl as any);
    contract = fakeContract();
    service = new OnChainTokenService(contract, undefined, undefined, undefined, undefined);
  });

  test("hold routes to the registered standard, never the operator contract", async () => {
    const receipt = await service.hold("idem", "nonce", { finId: "borrower-finid" }, { finId: "lender-finid" },
      collateralAsset, "1", signature, "op-1", exCtx);
    expect(receipt.type).toBe("success");
    expect(impl.hold).toHaveBeenCalledTimes(1);
    const record = impl.hold.mock.calls[0][2];
    expect(record).toEqual({ contractAddress: AGREEMENT_ID, decimals: 0, tokenStandard: COLLATERAL_STANDARD });
  });

  test("release resolves destination finId to an address and passes phase", async () => {
    const receipt = await service.release("idem", { finId: "borrower-finid" }, { finId: "lender-finid" },
      collateralAsset, "1", "op-1", exCtx);
    expect(receipt.type).toBe("success");
    expect(contract.getCredentialAddress).toHaveBeenCalledWith("lender-finid");
    const [, record, to, , , opCtx] = impl.release.mock.calls[0];
    expect(record.contractAddress).toBe(AGREEMENT_ID);
    expect(to).toBe(LENDER_ADDR);
    expect(opCtx.phase).toBe(Phase.Initiate); // sequence 4 → initiate
  });

  test("release at closing sequence carries Phase.Close", async () => {
    await service.release("idem", { finId: "lender-finid" }, { finId: "borrower-finid" },
      collateralAsset, "1", "op-2", { planId: "plan-1", sequence: 8 });
    const opCtx = impl.release.mock.calls[0][5];
    expect(opCtx.phase).toBe(Phase.Close);
  });

  test("rollback releases back to the source address", async () => {
    const receipt = await service.rollback("idem", { finId: "borrower-finid" }, collateralAsset, "1", "op-1", exCtx);
    expect(receipt.type).toBe("success");
    const to = impl.release.mock.calls[0][2];
    expect(to).toBe(BORROWER_ADDR);
  });

  test("transfer routes to the standard and surfaces its refusal as a failed receipt", async () => {
    const receipt = await service.transfer("idem", "nonce", { finId: "borrower-finid" }, { finId: "lender-finid" },
      collateralAsset, "1", signature, exCtx);
    expect(receipt.type).toBe("failure");
    expect(impl.transfer).toHaveBeenCalledTimes(1);
  });

  test("balance reads the registry via the standard, not the operator contract", async () => {
    expect(await service.getBalance(collateralAsset, "borrower-finid")).toBe("1");
    expect(await service.balance(collateralAsset, "borrower-finid")).toEqual({ current: "1", available: "1", held: "0" });
    expect(impl.balanceOf).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ contractAddress: AGREEMENT_ID }), BORROWER_ADDR, expect.anything());
  });

  test("failed standard result maps to a failed receipt", async () => {
    tokenStandardRegistry.reset();
    const failing = fakeStandard({ status: "failure", reason: "agreement not FUNDED" });
    tokenStandardRegistry.register(COLLATERAL_STANDARD, failing as any);
    const receipt = await service.hold("idem", "nonce", { finId: "borrower-finid" }, { finId: "lender-finid" },
      collateralAsset, "1", signature, "op-1", exCtx);
    expect(receipt.type).toBe("failure");
  });

  test("non-collateral asset falls through to the operator contract path", async () => {
    const erc20Asset: Asset = {
      assetId: "bank:102:token",
      assetType: "finp2p",
      ledgerIdentifier: { assetIdentifierType: "CAIP-19", tokenId: "0x3333333333333333333333333333333333333333", standard: "ERC20" },
    };
    const receipt = await service.release("idem", { finId: "a" }, { finId: "b" }, erc20Asset, "1", "op-1", exCtx);
    // fake contract throws → the on-chain path was taken and reported failure
    expect(receipt.type).toBe("failure");
    expect(impl.release).not.toHaveBeenCalled();
  });

  test("collateral standard not registered → falls through to the operator contract path", async () => {
    tokenStandardRegistry.reset();
    const receipt = await service.release("idem", { finId: "a" }, { finId: "b" }, collateralAsset, "1", "op-1", exCtx);
    expect(receipt.type).toBe("failure");
  });
});
