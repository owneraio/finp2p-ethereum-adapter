import { isHederaNetwork } from "../src/services/direct/wallet-activation";
import { WalletActivationOption } from "../src/services/direct/wallet-activation-option";
import { IntrospectedPlan } from "../src/services/plan-approval";

const ORG = "bank-us";
const ASSET_ID = `${ORG}:102:asset-1`;

const ALICE = "02" + "aa".repeat(32);
const BOB = "03" + "bb".repeat(32);
const ADDR: Record<string, string> = {
  [ALICE]: "0x1111111111111111111111111111111111111111",
  [BOB]: "0x2222222222222222222222222222222222222222"
};
const EXPLICIT_ADDR = "0x3333333333333333333333333333333333333333";

function mockProvider(chainId: bigint, clientVersion?: string | Error) {
  return {
    getNetwork: async () => ({ chainId }),
    networkCalls: 0,
    send: clientVersion === undefined ? undefined : async (method: string) => {
      if (method !== "web3_clientVersion") throw new Error(`unexpected ${method}`);
      if (clientVersion instanceof Error) throw clientVersion;
      return clientVersion;
    }
  } as any;
}

describe("isHederaNetwork", () => {

  test("recognizes well-known Hedera chain ids", async () => {
    for (const chainId of [295n, 296n, 297n, 298n]) {
      expect(await isHederaNetwork(mockProvider(chainId))).toBe(true);
    }
  });

  test("recognizes the JSON-RPC relay on a custom chain id (HashSphere-style)", async () => {
    expect(await isHederaNetwork(mockProvider(1337n, "relay/0.32.0"))).toBe(true);
  });

  test("plain EVM networks are not detected", async () => {
    expect(await isHederaNetwork(mockProvider(1n))).toBe(false);
    expect(await isHederaNetwork(mockProvider(1337n, "Geth/v1.13.0"))).toBe(false);
  });

  test("a node not implementing the probe is definitively not the relay", async () => {
    expect(await isHederaNetwork(mockProvider(1337n, new Error("method not found")))).toBe(false);
    expect(await isHederaNetwork(mockProvider(1337n, Object.assign(new Error("nope"), { code: -32601 })))).toBe(false);
    expect(await isHederaNetwork(mockProvider(1337n,
      new Error("the method web3_clientVersion does not exist/is not available")))).toBe(false);
  });

  test("transient probe failures propagate instead of reading as not-Hedera", async () => {
    await expect(isHederaNetwork(mockProvider(1337n, new Error("connection refused"))))
      .rejects.toThrow("connection refused");
    // generic outage phrasings must not be mistaken for method-not-found
    await expect(isHederaNetwork(mockProvider(1337n, new Error("service is not available"))))
      .rejects.toThrow("service is not available");
    await expect(isHederaNetwork(mockProvider(1337n, new Error("upstream does not exist"))))
      .rejects.toThrow("upstream does not exist");
  });
});

describe("WalletActivationOption", () => {

  type Touch = { to: string; value: bigint };

  function build(opts: {
    chainId?: bigint;
    balances?: Record<string, bigint>;
    gasStation?: boolean;
    mapped?: Record<string, string>;
    amount?: string;
    failFor?: string;
    /** consumed one per detection probe; string = client version, Error = probe failure */
    clientVersions?: Array<string | Error>;
  } = {}) {
    const touches: Touch[] = [];
    const balances: Record<string, bigint> = { ...(opts.balances ?? {}) };
    const clientVersions = [...(opts.clientVersions ?? [])];
    let networkCalls = 0;

    const provider = {
      getNetwork: async () => { networkCalls++; return { chainId: opts.chainId ?? 296n }; },
      getBalance: async (address: string) => balances[address] ?? 0n,
      send: opts.clientVersions === undefined ? undefined : async (method: string) => {
        if (method !== "web3_clientVersion") throw new Error(`unexpected ${method}`);
        const next = clientVersions.shift();
        if (next === undefined) throw new Error("no more probe responses");
        if (next instanceof Error) throw next;
        return next;
      }
    };
    const signer = {
      sendTransaction: async (tx: { to: string; value: bigint }) => {
        if (opts.failFor === tx.to) throw new Error("funding wallet out of funds");
        touches.push(tx);
        balances[tx.to] = tx.value;
        return {};
      }
    };
    const custodyProvider = {
      rpcProvider: provider,
      gasStation: opts.gasStation === false ? undefined : { wallet: { provider, signer } }
    } as any;
    const accountMapping = {
      resolveAccount: async (finId: string) => (opts.mapped ?? ADDR)[finId]
    } as any;

    const option = new WalletActivationOption(custodyProvider, accountMapping, opts.amount);
    return { option, touches, callCounts: () => ({ networkCalls }) };
  }

  const instruction = (type: string, source?: string, destination?: string, local = true,
    addresses: { destinationAddress?: string } = {}) => ({
    type, organizations: [ORG], local, sourceFinId: source, destinationFinId: destination, assetId: ASSET_ID, ...addresses
  });

  const plan = (instructions: any[]): IntrospectedPlan => ({ planId: "plan-1", orgId: ORG, instructions, raw: {} });

  test("touches destinations of receiving instructions, never sources", async () => {
    const { option, touches } = build();
    await option.apply(plan([
      instruction("issue", undefined, ALICE),
      instruction("transfer", ALICE, BOB)
    ]));
    expect(touches.map(t => t.to).sort()).toEqual([ADDR[ALICE], ADDR[BOB]].sort());
  });

  test("hold destinations are not touched (they receive only at release)", async () => {
    const { option, touches } = build();
    await option.apply(plan([
      instruction("hold", ALICE, BOB),
      instruction("redeem", ALICE, undefined)
    ]));
    expect(touches).toHaveLength(0);
  });

  test("already-activated destinations (balance > 0) are left alone", async () => {
    const { option, touches } = build({ balances: { [ADDR[ALICE]]: 1n } });
    await option.apply(plan([instruction("issue", undefined, ALICE)]));
    expect(touches).toHaveLength(0);
  });

  test("destinations are deduplicated across instructions", async () => {
    const { option, touches } = build();
    await option.apply(plan([
      instruction("transfer", ALICE, BOB),
      instruction("release", ALICE, BOB)
    ]));
    expect(touches).toHaveLength(1);
    expect(touches[0].to).toBe(ADDR[BOB]);
  });

  test("no-op on non-Hedera networks and without a gas station", async () => {
    const evm = build({ chainId: 1n });
    await evm.option.apply(plan([instruction("issue", undefined, ALICE)]));
    expect(evm.touches).toHaveLength(0);

    const noStation = build({ gasStation: false });
    await noStation.option.apply(plan([instruction("issue", undefined, ALICE)]));
    expect(noStation.touches).toHaveLength(0);
  });

  test.each([
    "connection refused",
    "service is not available",
  ])("a transient probe failure (%s) is retried on the next plan, not cached as not-Hedera", async (message) => {
    const { option, touches, callCounts } = build({
      chainId: 1337n,
      clientVersions: [new Error(message), "relay/0.32.0"]
    });
    // first plan: probe fails transiently — skip activation, leave undetected
    await expect(option.apply(plan([instruction("issue", undefined, ALICE)]))).resolves.toBeUndefined();
    expect(touches).toHaveLength(0);
    // second plan: probe succeeds — network detected, destination activated
    await option.apply(plan([instruction("issue", undefined, ALICE)]));
    expect(touches.map(t => t.to)).toEqual([ADDR[ALICE]]);
    expect(callCounts().networkCalls).toBe(2);
  });

  test("detection result is cached across plans", async () => {
    const { option, touches, callCounts } = build();
    await option.apply(plan([instruction("issue", undefined, ALICE)]));
    await option.apply(plan([instruction("issue", undefined, BOB)]));
    expect(callCounts().networkCalls).toBe(1);
    expect(touches).toHaveLength(2);
  });

  test("explicit ledger address is used for transfer destinations, mirroring execution", async () => {
    const { option, touches } = build({ mapped: { [ALICE]: ADDR[ALICE] } }); // BOB unmapped
    await option.apply(plan([
      instruction("transfer", ALICE, BOB, true, { destinationAddress: EXPLICIT_ADDR })
    ]));
    expect(touches.map(t => t.to)).toEqual([EXPLICIT_ADDR]);
  });

  test("unresolvable destinations and non-local instructions are skipped without failing", async () => {
    const { option, touches } = build({ mapped: {} });
    await expect(option.apply(plan([
      instruction("issue", undefined, ALICE),
      instruction("transfer", ALICE, BOB, false)
    ]))).resolves.toBeUndefined();
    expect(touches).toHaveLength(0);
  });

  test("a failed touch is best-effort: logged, other destinations still activated", async () => {
    const { option, touches } = build({ failFor: ADDR[ALICE] });
    await expect(option.apply(plan([
      instruction("issue", undefined, ALICE),
      instruction("issue", undefined, BOB)
    ]))).resolves.toBeUndefined();
    expect(touches.map(t => t.to)).toEqual([ADDR[BOB]]);
  });
});
