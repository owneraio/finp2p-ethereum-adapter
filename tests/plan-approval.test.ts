import { ConfigurablePlanApprovalService, PlanApprovalOption, IntrospectedPlan } from "../src/services/plan-approval";
import { GasPrefundingOption } from "../src/services/direct/gas-prefunding-option";

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

const approved = () => ({ operation: "approval", type: "approved" }) as any;
const rejected = (msg = "no") => ({ operation: "approval", type: "rejected", code: 1, message: msg }) as any;

function planClient(instructions: any[], planPresent = true) {
  return {
    getExecutionPlan: async () => ({ data: planPresent ? { plan: { instructions } } : {} })
  } as any;
}

describe("ConfigurablePlanApprovalService", () => {

  const recordingOption = (log: string[], veto = false): PlanApprovalOption => ({
    name: veto ? "vetoer" : "recorder",
    apply: async (plan: IntrospectedPlan) => {
      log.push(`${plan.planId}:${plan.instructions.length}`);
      return veto ? rejected("vetoed by option") : undefined;
    }
  });

  test("delegates approval to the base, then runs options over the introspected plan once", async () => {
    const log: string[] = [];
    let fetches = 0;
    const client = { getExecutionPlan: async () => { fetches++; return { data: { plan: { instructions: [instruction(1, "hold", ALICE_FIN_ID)] } } }; } } as any;
    const base = { approvePlan: async () => approved() } as any;
    const service = new ConfigurablePlanApprovalService(ORG, client, base, [recordingOption(log), recordingOption(log)]);

    const result = await service.approvePlan("ik", "plan-1");
    expect(result.type).toBe("approved");
    expect(log).toEqual(["plan-1:1", "plan-1:1"]); // both options ran
    expect(fetches).toBe(1);                        // introspected once, shared
  });

  test("skips options and does not fetch when the base rejects", async () => {
    const log: string[] = [];
    let fetches = 0;
    const client = { getExecutionPlan: async () => { fetches++; return { data: { plan: { instructions: [] } } }; } } as any;
    const base = { approvePlan: async () => rejected("base said no") } as any;
    const service = new ConfigurablePlanApprovalService(ORG, client, base, [recordingOption(log)]);

    const result = await service.approvePlan("ik", "plan-2");
    expect(result.type).toBe("rejected");
    expect(log).toEqual([]);
    expect(fetches).toBe(0);
  });

  test("an option can veto: its rejected status is returned instead of the base approval", async () => {
    const log: string[] = [];
    const base = { approvePlan: async () => approved() } as any;
    const service = new ConfigurablePlanApprovalService(
      ORG, planClient([instruction(1, "hold", ALICE_FIN_ID)]), base, [recordingOption(log, true)]);

    const result = await service.approvePlan("ik", "plan-3");
    expect(result.type).toBe("rejected");
    expect((result as any).message).toBe("vetoed by option");
  });

  test("introspection failure leaves the base approval intact", async () => {
    const base = { approvePlan: async () => approved() } as any;
    const client = { getExecutionPlan: async () => { throw new Error("fetch failed"); } } as any;
    const ran: string[] = [];
    const option: PlanApprovalOption = { name: "x", apply: async () => { ran.push("ran"); } };
    const service = new ConfigurablePlanApprovalService(ORG, client, base, [option]);

    const result = await service.approvePlan("ik", "plan-4");
    expect(result.type).toBe("approved");
    expect(ran).toEqual([]); // options skipped when introspection fails
  });

  test("with no options, it is a thin pass-through to the base", async () => {
    let fetches = 0;
    const client = { getExecutionPlan: async () => { fetches++; return { data: { plan: { instructions: [] } } }; } } as any;
    const base = { approvePlan: async () => approved() } as any;
    const service = new ConfigurablePlanApprovalService(ORG, client, base, []);
    expect((await service.approvePlan("ik", "plan-5")).type).toBe("approved");
    expect(fetches).toBe(0);
  });
});

describe("GasPrefundingOption", () => {

  function buildOption(opts: { gasStation?: boolean } = {}) {
    const funded: string[] = [];
    const fundedCounts = new Map<string, number>();
    const gasStation = opts.gasStation === false ? undefined : {
      ensureGas: async (address: string, txCount: number = 1) => { funded.push(address); fundedCounts.set(address, txCount); }
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
    return { option: new GasPrefundingOption(custodyProvider, accountMapping), custodyProvider, funded, fundedCounts };
  }

  const introspect = (instructions: any[]): IntrospectedPlan => ({
    planId: "plan",
    orgId: ORG,
    instructions: instructions.map((i) => ({
      sequence: i.sequence,
      type: i.executionPlanOperation.type,
      organizations: i.organizations,
      local: i.organizations.length === 0 || i.organizations.includes(ORG),
      sourceFinId: i.executionPlanOperation.source?.finp2pAccount?.account?.finId
    })),
    raw: {}
  });

  test("funds every wallet once, scaled to its instruction count", async () => {
    const { option, funded, fundedCounts } = buildOption();
    await option.apply(introspect([
      instruction(1, "issue"),
      instruction(2, "hold", ALICE_FIN_ID),
      instruction(3, "transfer", BOB_FIN_ID),
      instruction(4, "transfer", BOB_FIN_ID),
      instruction(5, "release")
    ]));
    expect(funded.sort()).toEqual([ISSUER_ADDRESS, ESCROW_ADDRESS, ALICE_ADDRESS, BOB_ADDRESS].sort());
    expect(fundedCounts.get(BOB_ADDRESS)).toBe(2);
    expect(fundedCounts.get(ALICE_ADDRESS)).toBe(1);
  });

  test("skips instructions executing on other ledgers", async () => {
    const { option, funded } = buildOption();
    await option.apply(introspect([
      instruction(1, "hold", ALICE_FIN_ID),
      instruction(2, "transfer", BOB_FIN_ID, [OTHER_ORG])
    ]));
    expect(funded).toEqual([ALICE_ADDRESS]);
  });

  test("redeem funds both the escrow wallet and the investor", async () => {
    const { option, funded } = buildOption();
    await option.apply(introspect([instruction(1, "redeem", ALICE_FIN_ID)]));
    expect(funded.sort()).toEqual([ESCROW_ADDRESS, ALICE_ADDRESS].sort());
  });

  test("is a no-op without a gas station", async () => {
    const { option, funded } = buildOption({ gasStation: false });
    await option.apply(introspect([instruction(1, "hold", ALICE_FIN_ID)]));
    expect(funded).toEqual([]);
  });

  test("one wallet's funding failure does not skip the others", async () => {
    const { option, custodyProvider, funded } = buildOption();
    custodyProvider.gasStation.ensureGas = async (address: string) => {
      if (address === ALICE_ADDRESS) throw new Error("funding tx failed");
      funded.push(address);
    };
    await expect(option.apply(introspect([
      instruction(1, "hold", ALICE_FIN_ID),
      instruction(2, "release"),
      instruction(3, "issue")
    ]))).resolves.toBeUndefined();
    expect(funded.sort()).toEqual([ESCROW_ADDRESS, ISSUER_ADDRESS].sort());
  });

  test("unresolvable source finIds are skipped, not fatal", async () => {
    const { option, funded } = buildOption();
    await option.apply(introspect([
      instruction(1, "hold", "02" + "ff".repeat(32)),
      instruction(2, "release")
    ]));
    expect(funded).toEqual([ESCROW_ADDRESS]);
  });
});
