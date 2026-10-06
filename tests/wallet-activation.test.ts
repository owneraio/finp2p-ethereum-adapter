import { WalletActivator, isHederaNetwork } from "../src/services/gas-station/wallet-activation";

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

describe("WalletActivator", () => {

  function build(opts: { balances?: Record<string, bigint>; failFor?: string; amount?: string } = {}) {
    const touches: Array<{ to: string; value: bigint }> = [];
    const balances: Record<string, bigint> = { ...(opts.balances ?? {}) };
    const provider = { getBalance: async (address: string) => balances[address] ?? 0n };
    const signer = {
      getAddress: async () => "0xGAS0000000000000000000000000000000000000",
      sendTransaction: async (tx: { to: string; value: bigint }) => {
        if (opts.failFor === tx.to) throw new Error("funding wallet out of funds");
        touches.push(tx);
        balances[tx.to] = tx.value;
        return { hash: "0xactivation" };
      },
    };
    return { activator: new WalletActivator({ provider, signer } as any, opts.amount ?? "0.001"), touches };
  }

  test("zero-balance address gets the one-time touch and the tx hash is returned", async () => {
    const { activator, touches } = build();
    const hash = await activator.ensureActivated("0x1111111111111111111111111111111111111111");
    expect(hash).toBe("0xactivation");
    expect(touches).toHaveLength(1);
  });

  test("an already-active address is never touched", async () => {
    const { activator, touches } = build({ balances: { "0x2222222222222222222222222222222222222222": 5n } });
    const hash = await activator.ensureActivated("0x2222222222222222222222222222222222222222");
    expect(hash).toBeUndefined();
    expect(touches).toHaveLength(0);
  });

  test("a funding failure propagates", async () => {
    const { activator } = build({ failFor: "0x3333333333333333333333333333333333333333" });
    await expect(activator.ensureActivated("0x3333333333333333333333333333333333333333"))
      .rejects.toThrow(/out of funds/);
  });
});
