import { ConfigurablePlanApprovalService, PlanApprovalOption, IntrospectedPlan, introspectPlan } from "../src/services/plan-approval";
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

  const recordingOption = (log: string[], veto = false, gating = false): PlanApprovalOption => ({
    name: veto ? "vetoer" : "recorder",
    gating,
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
    const option: PlanApprovalOption = { name: "x", gating: false, apply: async () => { ran.push("ran"); } };
    const service = new ConfigurablePlanApprovalService(ORG, client, base, [option]);

    const result = await service.approvePlan("ik", "plan-4");
    expect(result.type).toBe("approved");
    expect(ran).toEqual([]); // non-gating options skipped when introspection fails
  });

  test("introspection failure REJECTS when a gating option cannot run", async () => {
    const base = { approvePlan: async () => approved() } as any;
    const client = { getExecutionPlan: async () => { throw new Error("fetch failed"); } } as any;
    const ran: string[] = [];
    const gatingOption: PlanApprovalOption = { name: "whitelist", gating: true, apply: async () => { ran.push("ran"); } };
    const service = new ConfigurablePlanApprovalService(ORG, client, base, [gatingOption]);

    const result = await service.approvePlan("ik", "plan-4b");
    expect(result.type).toBe("rejected");
    expect(ran).toEqual([]); // never got to run — plan couldn't be introspected
  });

  test("missing plan (no data.plan) also rejects for a gating option", async () => {
    const base = { approvePlan: async () => approved() } as any;
    const service = new ConfigurablePlanApprovalService(
      ORG, planClient([], false), base,
      [{ name: "whitelist", gating: true, apply: async () => undefined }]);
    expect((await service.approvePlan("ik", "plan-4c")).type).toBe("rejected");
  });

  test("no FinP2P client rejects for a gating option, but passes through for non-gating", async () => {
    const base = { approvePlan: async () => approved() } as any;
    const gating = new ConfigurablePlanApprovalService(
      ORG, undefined, base, [{ name: "whitelist", gating: true, apply: async () => undefined }]);
    expect((await gating.approvePlan("ik", "plan-4d")).type).toBe("rejected");

    const log: string[] = [];
    const nonGating = new ConfigurablePlanApprovalService(ORG, undefined, base, [recordingOption(log)]);
    expect((await nonGating.approvePlan("ik", "plan-4e")).type).toBe("approved");
    expect(log).toEqual([]); // option skipped — nothing to introspect
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

  function buildOption(opts: { gasStation?: boolean, placeholderFixed?: boolean, mappingThrows?: boolean } = {}) {
    const funded: string[] = [];
    const fundedCounts = new Map<string, number>();
    const gasStation = opts.gasStation === false ? undefined : {
      ensureGas: async (address: string, txCount: number = 1) => { funded.push(address); fundedCounts.set(address, txCount); }
    };
    // placeholderFixed mimics Fireblocks local-submit: issuer/escrow are a
    // JsonRpcProvider placeholder whose signer has no getAddress()
    const fixedWallet = opts.placeholderFixed
      ? { signer: {} }
      : undefined;
    const custodyProvider = {
      gasStation,
      issuer: fixedWallet ?? { signer: { getAddress: async () => ISSUER_ADDRESS } },
      escrow: fixedWallet ?? { signer: { getAddress: async () => ESCROW_ADDRESS } }
    } as any;
    const accountMapping = {
      resolveAccount: async (finId: string) => {
        if (opts.mappingThrows) throw new Error("transient DB error");
        return finId === ALICE_FIN_ID ? ALICE_ADDRESS : finId === BOB_FIN_ID ? BOB_ADDRESS : undefined;
      }
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

  test("placeholder issuer/escrow wallet (Fireblocks local-submit) does not abort — investor still funded", async () => {
    const { option, funded } = buildOption({ placeholderFixed: true });
    // a transfer-only plan must not touch the (unavailable) fixed wallets
    await expect(option.apply(introspect([
      instruction(1, "transfer", ALICE_FIN_ID)
    ]))).resolves.toBeUndefined();
    expect(funded).toEqual([ALICE_ADDRESS]);

    // a plan that would use the escrow wallet skips it (unresolvable) instead of throwing
    const b = buildOption({ placeholderFixed: true });
    await expect(b.option.apply(introspect([
      instruction(1, "hold", ALICE_FIN_ID),
      instruction(2, "release")
    ]))).resolves.toBeUndefined();
    expect(b.funded).toEqual([ALICE_ADDRESS]); // escrow skipped, investor funded
  });

  test("account-mapping failure is swallowed (best-effort), does not throw", async () => {
    const { option, funded } = buildOption({ mappingThrows: true });
    await expect(option.apply(introspect([
      instruction(1, "issue"),
      instruction(2, "hold", ALICE_FIN_ID),
      instruction(3, "release")
    ]))).resolves.toBeUndefined();
    // investor skipped (mapping threw); fixed issuer/escrow still funded
    expect(funded.sort()).toEqual([ISSUER_ADDRESS, ESCROW_ADDRESS].sort());
  });
});

describe("introspectPlan", () => {

  test("surfaces explicit networkAccount ledger addresses alongside finIds", () => {
    const raw = {
      instructions: [{
        sequence: 1,
        organizations: [ORG],
        executionPlanOperation: {
          type: "transfer",
          source: { finp2pAccount: { account: { finId: ALICE_FIN_ID }, asset: { id: `${ORG}:102:asset-1` } } },
          destination: {
            finp2pAccount: { account: { finId: BOB_FIN_ID } },
            networkAccount: { type: "walletAccount", address: BOB_ADDRESS }
          },
          amount: "10"
        }
      }]
    };
    const plan = introspectPlan("plan-1", ORG, raw);
    expect(plan.instructions[0].sourceFinId).toBe(ALICE_FIN_ID);
    expect(plan.instructions[0].sourceAddress).toBeUndefined();
    expect(plan.instructions[0].destinationFinId).toBe(BOB_FIN_ID);
    expect(plan.instructions[0].destinationAddress).toBe(BOB_ADDRESS);
  });
});
