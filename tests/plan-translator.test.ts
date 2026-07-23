import {
  ExecutionVenue,
  NO_SIGNATURE,
  PlanInstructionType,
  ValidationError
} from "@owneraio/finp2p-ethereum-orchestrator";
import {
  RawExecutionPlan,
  RawLedgerAccountAsset,
  RawPlanInstruction,
  RawSignature,
  holdOperationId,
  translateExecutionPlan
} from "../src/services/orchestration/plan-translator";

const ORG = "bank-us";
const OTHER_ORG = "bank-uk";

const BUYER_FIN_ID = "02" + "11".repeat(32);
const SELLER_FIN_ID = "03" + "22".repeat(32);

const ASSET_ID = `${ORG}:102:asset-1`;
const SETTLEMENT_ID = "USD";
const PLAN_ID = `${ORG}:106:plan-1`;

const account = (finId: string, assetId: string): RawLedgerAccountAsset => ({
  finp2pAccount: { asset: { id: assetId }, account: { finId, orgId: ORG } }
});

const buyingSignature = (signature: string): RawSignature => ({
  signature,
  template: {
    type: "EIP712",
    primaryType: "Buying",
    message: {
      nonce: "nonce-1",
      buyer: { idkey: BUYER_FIN_ID },
      seller: { idkey: SELLER_FIN_ID },
      asset: { assetId: ASSET_ID, assetType: "finp2p", amount: "10" },
      settlement: { assetId: SETTLEMENT_ID, assetType: "fiat", amount: "100" }
    }
  }
});

const sellingSignature = (signature: string): RawSignature => ({
  signature,
  template: {
    type: "EIP712",
    primaryType: "Selling",
    message: {
      nonce: "nonce-2",
      buyer: { idkey: BUYER_FIN_ID },
      seller: { idkey: SELLER_FIN_ID },
      asset: { assetId: ASSET_ID, assetType: "finp2p", amount: "10" },
      settlement: { assetId: SETTLEMENT_ID, assetType: "fiat", amount: "100" }
    }
  }
});

const redemptionSignature = (signature: string): RawSignature => ({
  signature,
  template: {
    type: "EIP712",
    primaryType: "Redemption",
    message: {
      nonce: "nonce-3",
      issuer: { idkey: BUYER_FIN_ID },
      seller: { idkey: SELLER_FIN_ID },
      asset: { assetId: ASSET_ID, assetType: "finp2p", amount: "10" },
      settlement: { assetId: SETTLEMENT_ID, assetType: "fiat", amount: "100" }
    }
  }
});

const plan = (instructions: RawPlanInstruction[]): RawExecutionPlan => ({ id: PLAN_ID, instructions });

describe("plan translator", () => {

  test("translates a local DvP plan: hold, transfer, release", () => {
    const raw = plan([
      {
        sequence: 1, organizations: [ORG],
        executionPlanOperation: {
          type: "hold",
          source: account(BUYER_FIN_ID, SETTLEMENT_ID),
          destination: account(SELLER_FIN_ID, SETTLEMENT_ID),
          amount: "100",
          signature: buyingSignature("aa".repeat(65))
        }
      },
      {
        sequence: 2, organizations: [ORG],
        executionPlanOperation: {
          type: "transfer",
          source: account(SELLER_FIN_ID, ASSET_ID),
          destination: account(BUYER_FIN_ID, ASSET_ID),
          amount: "10",
          signature: sellingSignature("bb".repeat(65))
        }
      },
      {
        sequence: 3, organizations: [ORG],
        executionPlanOperation: {
          type: "release",
          source: account(BUYER_FIN_ID, SETTLEMENT_ID),
          destination: account(SELLER_FIN_ID, SETTLEMENT_ID),
          amount: "100"
        }
      }
    ]);

    const { instructions, signatures } = translateExecutionPlan(raw, ORG);

    expect(instructions).toHaveLength(3);
    expect(signatures).toHaveLength(2);

    const [hold, transfer, release] = instructions;
    expect(hold.instructionType).toBe(PlanInstructionType.Hold);
    expect(hold.venue).toBe(ExecutionVenue.OnLedger);
    expect(hold.assetId).toBe(SETTLEMENT_ID);
    expect(hold.assetType).toBe(1); // fiat, resolved from the settlement term
    expect(hold.source).toBe(BUYER_FIN_ID);
    expect(hold.destination).toBe(SELLER_FIN_ID);
    expect(hold.operationId).toBe(holdOperationId(PLAN_ID, 1));
    expect(hold.signatureIndex).toBe(0);

    expect(transfer.instructionType).toBe(PlanInstructionType.Transfer);
    expect(transfer.assetId).toBe(ASSET_ID);
    expect(transfer.assetType).toBe(0); // finp2p
    expect(transfer.signatureIndex).toBe(1);

    expect(release.instructionType).toBe(PlanInstructionType.Release);
    expect(release.operationId).toBe(hold.operationId);
    expect(release.source).toBe(BUYER_FIN_ID);
    expect(release.destination).toBe(SELLER_FIN_ID);
    expect(release.signatureIndex).toBe(NO_SIGNATURE);

    expect(signatures[0].signerFinId).toBe(BUYER_FIN_ID);
    expect(signatures[0].signature).toBe(`0x${"aa".repeat(65)}`);
    expect(signatures[1].signerFinId).toBe(SELLER_FIN_ID);
  });

  test("marks instructions of other organizations as remote", () => {
    const raw = plan([
      {
        sequence: 1, organizations: [ORG],
        executionPlanOperation: {
          type: "hold",
          source: account(BUYER_FIN_ID, SETTLEMENT_ID),
          destination: account(SELLER_FIN_ID, SETTLEMENT_ID),
          amount: "100",
          signature: buyingSignature("aa".repeat(65))
        }
      },
      {
        sequence: 2, organizations: [OTHER_ORG],
        executionPlanOperation: {
          type: "transfer",
          source: account(SELLER_FIN_ID, ASSET_ID),
          destination: account(BUYER_FIN_ID, ASSET_ID),
          amount: "10"
        }
      }
    ]);

    const { instructions, signatures } = translateExecutionPlan(raw, ORG);
    expect(instructions[1].venue).toBe(ExecutionVenue.OffLedger);
    expect(instructions[1].organizationId).toBe(OTHER_ORG);
    expect(instructions[1].signatureIndex).toBe(NO_SIGNATURE);
    expect(signatures).toHaveLength(1); // only the local hold's signature
  });

  test("maps redeem after hold to release-and-redeem with the hold's operationId", () => {
    const raw = plan([
      {
        sequence: 1, organizations: [ORG],
        executionPlanOperation: {
          type: "hold",
          source: account(SELLER_FIN_ID, ASSET_ID),
          amount: "10",
          signature: redemptionSignature("cc".repeat(65))
        }
      },
      {
        sequence: 2, organizations: [ORG],
        executionPlanOperation: {
          type: "redeem",
          source: account(SELLER_FIN_ID, ASSET_ID),
          destination: account(BUYER_FIN_ID, ASSET_ID),
          amount: "10",
          signature: redemptionSignature("cc".repeat(65))
        }
      }
    ]);

    const { instructions, signatures } = translateExecutionPlan(raw, ORG);
    expect(instructions[0].instructionType).toBe(PlanInstructionType.Hold);
    expect(instructions[0].destination).toBe("");
    expect(instructions[1].instructionType).toBe(PlanInstructionType.ReleaseAndRedeem);
    expect(instructions[1].operationId).toBe(instructions[0].operationId);
    // the same signature attached to both instructions is deduplicated
    expect(signatures).toHaveLength(1);
    expect(instructions[0].signatureIndex).toBe(0);
  });

  test("maps a standalone redeem to a direct burn", () => {
    const raw = plan([
      {
        sequence: 1, organizations: [ORG],
        executionPlanOperation: {
          type: "redeem",
          source: account(SELLER_FIN_ID, ASSET_ID),
          destination: account(BUYER_FIN_ID, ASSET_ID),
          amount: "10",
          signature: redemptionSignature("cc".repeat(65))
        }
      }
    ]);
    const { instructions } = translateExecutionPlan(raw, ORG);
    expect(instructions[0].instructionType).toBe(PlanInstructionType.Redeem);
    expect(instructions[0].operationId).toBe("");
  });

  test("maps revert-hold to the matching hold", () => {
    const raw = plan([
      {
        sequence: 1, organizations: [ORG],
        executionPlanOperation: {
          type: "hold",
          source: account(BUYER_FIN_ID, SETTLEMENT_ID),
          destination: account(SELLER_FIN_ID, SETTLEMENT_ID),
          amount: "100",
          signature: buyingSignature("aa".repeat(65))
        }
      },
      {
        sequence: 2, organizations: [ORG],
        executionPlanOperation: {
          type: "revertHoldInstruction",
          destination: account(BUYER_FIN_ID, SETTLEMENT_ID)
        }
      }
    ]);
    const { instructions } = translateExecutionPlan(raw, ORG);
    expect(instructions[1].instructionType).toBe(PlanInstructionType.RevertHold);
    expect(instructions[1].operationId).toBe(instructions[0].operationId);
    expect(instructions[1].amount).toBe("100");
  });

  test("rejects a local hold without a signature", () => {
    const raw = plan([
      {
        sequence: 1, organizations: [ORG],
        executionPlanOperation: {
          type: "hold",
          source: account(BUYER_FIN_ID, SETTLEMENT_ID),
          destination: account(SELLER_FIN_ID, SETTLEMENT_ID),
          amount: "100"
        }
      }
    ]);
    expect(() => translateExecutionPlan(raw, ORG)).toThrow(ValidationError);
  });

  test("rejects non-EIP712 signature templates", () => {
    const raw = plan([
      {
        sequence: 1, organizations: [ORG],
        executionPlanOperation: {
          type: "hold",
          source: account(BUYER_FIN_ID, SETTLEMENT_ID),
          destination: account(SELLER_FIN_ID, SETTLEMENT_ID),
          amount: "100",
          signature: { signature: "aa", template: { type: "hashList" } }
        }
      }
    ]);
    expect(() => translateExecutionPlan(raw, ORG)).toThrow(/EIP712/);
  });

  test("rejects a release whose amount differs from the matched hold", () => {
    const raw = plan([
      {
        sequence: 1, organizations: [ORG],
        executionPlanOperation: {
          type: "hold",
          source: account(BUYER_FIN_ID, SETTLEMENT_ID),
          destination: account(SELLER_FIN_ID, SETTLEMENT_ID),
          amount: "100",
          signature: buyingSignature("aa".repeat(65))
        }
      },
      {
        sequence: 2, organizations: [ORG],
        executionPlanOperation: {
          type: "release",
          source: account(BUYER_FIN_ID, SETTLEMENT_ID),
          destination: account(SELLER_FIN_ID, SETTLEMENT_ID),
          amount: "1"
        }
      }
    ]);
    expect(() => translateExecutionPlan(raw, ORG)).toThrow(/releases 1 but the matching hold is for 100/);
  });

  test("rejects a release matched against a destinationless hold", () => {
    // redeem-style holds (no destination) can only be burned or rolled back
    const raw = plan([
      {
        sequence: 1, organizations: [ORG],
        executionPlanOperation: {
          type: "hold",
          source: account(SELLER_FIN_ID, ASSET_ID),
          amount: "10",
          signature: redemptionSignature("cc".repeat(65))
        }
      },
      {
        sequence: 2, organizations: [ORG],
        executionPlanOperation: {
          type: "release",
          source: account(SELLER_FIN_ID, ASSET_ID),
          destination: account(BUYER_FIN_ID, ASSET_ID),
          amount: "10"
        }
      }
    ]);
    expect(() => translateExecutionPlan(raw, ORG)).toThrow(/no matching hold/);
  });

  test("rejects a release without a matching hold", () => {
    const raw = plan([
      {
        sequence: 1, organizations: [ORG],
        executionPlanOperation: {
          type: "release",
          source: account(BUYER_FIN_ID, SETTLEMENT_ID),
          destination: account(SELLER_FIN_ID, SETTLEMENT_ID),
          amount: "100"
        }
      }
    ]);
    expect(() => translateExecutionPlan(raw, ORG)).toThrow(/matching hold/);
  });

  test("rejects a remote transfer with a missing destination account", () => {
    const raw = plan([
      {
        sequence: 1, organizations: [OTHER_ORG],
        executionPlanOperation: {
          type: "transfer",
          source: account(SELLER_FIN_ID, ASSET_ID),
          amount: "10"
        }
      }
    ]);
    expect(() => translateExecutionPlan(raw, ORG)).toThrow(/transfer instruction 1 .* has no destination/);
  });

  test("forces await instructions on-ledger even when assigned to another org", () => {
    const raw = plan([
      {
        sequence: 1, organizations: [OTHER_ORG],
        executionPlanOperation: { type: "await", waitUntil: 0 }
      }
    ]);
    const { instructions } = translateExecutionPlan(raw, ORG);
    expect(instructions[0].instructionType).toBe(PlanInstructionType.Await);
    expect(instructions[0].venue).toBe(ExecutionVenue.OnLedger);
    expect(instructions[0].organizationId).toBe("");
  });

  test("rejects non-contiguous sequences", () => {
    const raw = plan([
      {
        sequence: 2, organizations: [ORG],
        executionPlanOperation: { type: "await", waitUntil: 0 }
      }
    ]);
    expect(() => translateExecutionPlan(raw, ORG)).toThrow(/non-contiguous/);
  });
});
