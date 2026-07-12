import { GasPrefundingPlanApprovalService } from "../src/services/direct/gas-prefunding-plan-approval";

const ORG = "bank-us";
const OTHER_ORG = "bank-uk";

const ISSUER_ADDRESS = "0x1111111111111111111111111111111111111111";
const ESCROW_ADDRESS = "0x2222222222222222222222222222222222222222";
const ALICE_FIN_ID = "02" + "aa".repeat(32);
const ALICE_ADDRESS = "0x3333333333333333333333333333333333333333";
const BOB_FIN_ID = "03" + "bb".repeat(32);
const BOB_ADDRESS = "0x4444444444444444444444444444444444444444";

const account = (finId: string) => ({ finp2pAccount: { account: { finId } } });

const instruction = (sequence: number, type: string, sourceFinId?: string, organizations: string[] = [ORG]) => ({
  sequence,
  organizations,
  executionPlanOperation: { type, ...(sourceFinId ? { source: account(sourceFinId) } : {}) }
});

function buildService(instructions: any[], opts: { gasStation?: boolean, innerResult?: string } = {}) {
  const funded: string[] = [];
  const fundedCounts = new Map<string, number>();
  const gasStation = opts.gasStation === false ? undefined : {
    ensureGas: async (address: string, txCount: number = 1) => {
      funded.push(address);
      fundedCounts.set(address, txCount);
    }
  };
  const custodyProvider = {
    gasStation,
    issuer: { signer: { getAddress: async () => ISSUER_ADDRESS } },
    escrow: { signer: { getAddress: async () => ESCROW_ADDRESS } }
  } as any;
  const accountMapping = {
    resolveAccount: async (finId: string) =>
      finId === ALICE_FIN_ID ? ALICE_ADDRESS : finId === BOB_FIN_ID ? BOB_ADDRESS : undefined
  } as any;
  const finP2PClient = {
    getExecutionPlan: async () => ({ data: { plan: { instructions } } })
  } as any;
  const innerCalls: string[] = [];
  const inner = {
    approvePlan: async () => {
      innerCalls.push("approvePlan");
      return { operation: "approval", type: opts.innerResult ?? "approved" };
    }
  } as any;
  const service = new GasPrefundingPlanApprovalService(ORG, custodyProvider, accountMapping, finP2PClient, inner);
  return { service, funded, fundedCounts, innerCalls };
}

describe("gas prefunding at plan approval", () => {

  test("funds every wallet once, with the threshold scaled to its instruction count", async () => {
    const { service, funded, fundedCounts } = buildService([
      instruction(1, "issue"),
      instruction(2, "hold", ALICE_FIN_ID),
      instruction(3, "transfer", BOB_FIN_ID),
      instruction(4, "transfer", BOB_FIN_ID), // same wallet twice — one top-up covering 2 txs
      instruction(5, "release")
    ]);
    const result = await service.approvePlan("ik", "plan-1");
    expect(result.type).toBe("approved");
    expect(funded.sort()).toEqual([ISSUER_ADDRESS, ESCROW_ADDRESS, ALICE_ADDRESS, BOB_ADDRESS].sort());
    expect(fundedCounts.get(BOB_ADDRESS)).toBe(2);
    expect(fundedCounts.get(ALICE_ADDRESS)).toBe(1);
  });

  test("a wallet signing many instructions is funded for all of them", async () => {
    const { service, fundedCounts } = buildService([
      instruction(1, "hold", ALICE_FIN_ID),
      instruction(2, "release"),
      instruction(3, "hold", ALICE_FIN_ID),
      instruction(4, "release"),
      instruction(5, "redeem", ALICE_FIN_ID)
    ]);
    await service.approvePlan("ik", "plan-1b");
    expect(fundedCounts.get(ALICE_ADDRESS)).toBe(3);  // 2 holds + self-burn side of redeem
    expect(fundedCounts.get(ESCROW_ADDRESS)).toBe(3); // 2 releases + escrow side of redeem
  });

  test("skips instructions executing on other ledgers", async () => {
    const { service, funded } = buildService([
      instruction(1, "hold", ALICE_FIN_ID),
      instruction(2, "transfer", BOB_FIN_ID, [OTHER_ORG])
    ]);
    await service.approvePlan("ik", "plan-2");
    expect(funded).toEqual([ALICE_ADDRESS]);
  });

  test("redeem funds both the escrow wallet and the investor (self-burn path)", async () => {
    const { service, funded } = buildService([
      instruction(1, "redeem", ALICE_FIN_ID)
    ]);
    await service.approvePlan("ik", "plan-3");
    expect(funded.sort()).toEqual([ESCROW_ADDRESS, ALICE_ADDRESS].sort());
  });

  test("does not fund when the plan is rejected by the inner service", async () => {
    const { service, funded, innerCalls } = buildService(
      [instruction(1, "hold", ALICE_FIN_ID)], { innerResult: "rejected" });
    const result = await service.approvePlan("ik", "plan-4");
    expect(result.type).toBe("rejected");
    expect(innerCalls).toEqual(["approvePlan"]);
    expect(funded).toEqual([]);
  });

  test("is a no-op without a gas station", async () => {
    const { service, funded } = buildService(
      [instruction(1, "hold", ALICE_FIN_ID)], { gasStation: false });
    const result = await service.approvePlan("ik", "plan-5");
    expect(result.type).toBe("approved");
    expect(funded).toEqual([]);
  });

  test("funding failures do not reject the plan", async () => {
    const { service } = buildService([instruction(1, "hold", ALICE_FIN_ID)]);
    (service as any).custodyProvider.gasStation.ensureGas = async () => {
      throw new Error("funding tx failed");
    };
    const result = await service.approvePlan("ik", "plan-6");
    expect(result.type).toBe("approved");
  });

  test("unresolvable source finIds are skipped with a warning, not fatal", async () => {
    const { service, funded } = buildService([
      instruction(1, "hold", "02" + "ff".repeat(32)), // unmapped investor
      instruction(2, "release")
    ]);
    const result = await service.approvePlan("ik", "plan-7");
    expect(result.type).toBe("approved");
    expect(funded).toEqual([ESCROW_ADDRESS]);
  });
});
