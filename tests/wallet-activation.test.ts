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
    balances?: Record<string, bigint>;
    gasStation?: boolean;
    mapped?: Record<string, string>;
    amount?: string;
    failFor?: string;
  } = {}) {
    const touches: Touch[] = [];
    const balances: Record<string, bigint> = { ...(opts.balances ?? {}) };

    const provider = { getBalance: async (address: string) => balances[address] ?? 0n };
    const signer = {
      sendTransaction: async (tx: { to: string; value: bigint }) => {
        if (opts.failFor === tx.to) throw new Error("funding wallet out of funds");
        touches.push(tx);
        balances[tx.to] = tx.value;
        return {};
      }
    };
    const custodyProvider = {
      gasStation: opts.gasStation === false ? undefined : { wallet: { provider, signer } }
    } as any;
    const accountMapping = {
      resolveAccount: async (finId: string) => (opts.mapped ?? ADDR)[finId]
    } as any;

    // the option no longer probes the network — that decision is made once at
    // startup (see isHederaNetwork tests above); here it is always enabled
    const option = new WalletActivationOption(custodyProvider, accountMapping, opts.amount);
    return { option, touches };
  }

  const instruction = (type: string, source?: string, destination?: string, local = true) => ({
    type, organizations: [ORG], local, sourceFinId: source, destinationFinId: destination, assetId: ASSET_ID
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

  test("hold, redeem and revertHold destinations are not touched", async () => {
    const { option, touches } = build();
    await option.apply(plan([
      instruction("hold", ALICE, BOB),                  // receives only at release
      instruction("redeem", ALICE, BOB),                // burns; no receiving destination here
      instruction("revertHoldInstruction", ALICE, BOB)  // returns held funds; not activated here
    ]));
    expect(touches).toHaveLength(0);
  });

  test("already-activated destinations (balance > 0) are left alone", async () => {
    const { option, touches } = build({ balances: { [ADDR[ALICE]]: 1n } });
    await option.apply(plan([instruction("issue", undefined, ALICE)]));
    expect(touches).toHaveLength(0);
  });

  test("a repeated destination is activated once (idempotent via balance check)", async () => {
    const { option, touches } = build();
    await option.apply(plan([
      instruction("transfer", ALICE, BOB),
      instruction("release", ALICE, BOB)
    ]));
    // the first touch funds BOB; the second sees a non-zero balance and no-ops
    expect(touches).toHaveLength(1);
    expect(touches[0].to).toBe(ADDR[BOB]);
  });

  test("is a no-op without a gas station", async () => {
    const { option, touches } = build({ gasStation: false });
    await option.apply(plan([instruction("issue", undefined, ALICE)]));
    expect(touches).toHaveLength(0);
  });

  test("resolution is account-mapping only — an explicit ledger address is not used", async () => {
    const { option, touches } = build({ mapped: { [ALICE]: ADDR[ALICE] } }); // BOB unmapped
    await option.apply(plan([
      instruction("transfer", ALICE, BOB)
    ]));
    expect(touches).toHaveLength(0); // BOB unresolvable via mapping → skipped, no fallback
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
