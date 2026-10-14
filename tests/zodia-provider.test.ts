import { createVerify, generateKeyPairSync, verify as ecdsaVerify } from "crypto";
import http from "http";
import { AddressInfo } from "net";
import { Contract, Interface } from "ethers";
import { ZodiaApiError, ZodiaClient, ZodiaCustodyProvider, ZodiaApi, endToEndIdOf, stableStringify } from "../src/integrations/custody/zodia";
import { ERC20TokenStandard } from "@owneraio/finp2p-ethereum-erc20-plugin";
import { runWithIdempotencyKey } from "../src/services/custody/idempotency-scope";
import { ZodiaAppConfig, parseTokenCurrencies } from "../src/integrations/custody/zodia/config";
import { ZodiaInstruction, ZodiaServiceRequest, ZodiaTransfer } from "../src/integrations/custody/zodia/client";
import { custodyProviderConformance } from "./utils/custody-provider-conformance";

const company = generateKeyPairSync("rsa", { modulusLength: 2048 });
const maker = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pemOf = (k: ReturnType<typeof generateKeyPairSync>["privateKey"]) => k.export({ type: "pkcs8", format: "pem" }).toString();

const ALICE = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BOB = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BENEFICIARY = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const STRANGER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const TMMF = "0xffc1912d680176275747ea916cb70d45f4a5b743";

const CONFIG: ZodiaAppConfig = {
  baseUrl: "https://zodia.example.test",
  companyId: "ZTEST",
  submitterId: "api-maker@example.com",
  companyPrivateKey: pemOf(company.privateKey),
  makerPrivateKey: pemOf(maker.privateKey),
  native: { currency: "eth", currencyId: "eth-Seth" },
  tokens: parseTokenCurrencies(`${TMMF}=TMMF:eth-Stmmf`),
  pollIntervalMs: 1,
  maxPollIntervalMs: 1,
  makerPollIntervalMs: 1,
};

interface FakeOptions {
  /** serviceRequests polls before the authoriser acts */
  approveAfter?: number;
  rejects?: boolean;
  /** the instruction states another amount than the one submitted */
  tamperAmount?: boolean;
  /** HTTP status of each serviceRequests read made while following a transfer, in order */
  followErrors?: number[];
}

/**
 * Two wallets and one beneficiary. The authoriser approves, or rejects, out
 * of band `approveAfter` polls later; a request the maker never confirms
 * times out in Zodia after the same number of polls.
 */
function fakeZodia(calls: unknown[][], options: FakeOptions = {}) {
  const addresses = [
    { address: ALICE, walletId: "ZTEST-NOBENF-ALICE", currencyId: "eth-Seth" },
    { address: BOB, walletId: "ZTEST-NOBENF-BOB", currencyId: "eth-Seth" },
  ];
  const requests = new Map<string, ZodiaServiceRequest & { payload: Record<string, any>; pendingPolls: number }>();
  const transfers: ZodiaTransfer[] = [];
  const followErrors = [...(options.followErrors ?? [])];
  let n = 0;
  const advance = () => {
    for (const r of requests.values()) {
      if (r.status !== "PENDING AUTHORISATION" && r.status !== "PENDING CONFIRMATION") continue;
      if (++r.pendingPolls <= (options.approveAfter ?? 2)) continue;
      if (r.status === "PENDING CONFIRMATION") { r.status = "CONFIRMATION TIMEOUT"; continue; }
      r.status = options.rejects ? "REJECTED BY AUTHORISER" : "CONFIRMED";
      if (!options.rejects) transfers.push({ id: r.entityId!, status: "POSTED ON CHAIN", currency: "eth", currencyId: "eth-Seth", ledgerRef: "0x" + r.entityId!.slice(-1).repeat(64), createdAt: "2026-10-14T10:00:00Z" });
    }
  };
  const api: ZodiaApi = {
    wallets: async (f = {}) => {
      calls.push(["wallets", f]);
      return [{ id: "ZTEST-NOBENF-ALICE", status: "ACTIVE", currency: "eth", currencyId: "eth-Seth",
        balances: [
          { currency: "ETH", availableBalance: { amount: "0.05", amountUnit: "50000000000000000" } },
          { currency: "TMMF", availableBalance: { amount: "12.5" } },
        ] }, { id: "ZTEST-NOBENF-BOB", status: "ACTIVE", currency: "eth", currencyId: "eth-Seth", balances: [] }]
        .filter(w => !f.ids || f.ids.includes(w.id));
    },
    currencies: async () => { calls.push(["currencies"]); return [{ currency: "eth", ratio: "1000000000000000000", currencyId: "eth-Seth" }, { currency: "TMMF", ratio: "100", currencyId: "eth-Stmmf" }]; },
    addresses: async (f = {}) => {
      calls.push(["addresses", f]);
      return addresses.filter(a => (!f.walletIds || f.walletIds.includes(a.walletId)) && (!f.addresses || f.addresses.some(x => x.toLowerCase() === a.address.toLowerCase())));
    },
    transactions: async (f = {}) => { calls.push(["transactions", f]); return transfers; },
    beneficiaryAddresses: async (f = {}) => {
      calls.push(["beneficiaryAddresses", f]);
      return f.addresses?.some(a => a.toLowerCase() === BENEFICIARY.toLowerCase())
        ? [{ cryptoAddressId: "bnf-addr-7", address: BENEFICIARY, blockchain: "ETH", blockchainId: "eth-Seth", status: "ACTIVE", addressPurpose: ["OUTGOING"] }]
        : [];
    },
    serviceRequests: async f => {
      calls.push(["serviceRequests", f]);
      if (f.requestIds && followErrors.length) {
        const status = followErrors.shift()!;
        throw new ZodiaApiError(status, "/v3/api/servicedesk/requests", `{"title":"http ${status}"}`);
      }
      if (f.requestIds) advance();
      return [...requests.values()].filter(r => (!f.requestIds || f.requestIds.includes(r.requestId)) && (!f.endToEndIds || f.endToEndIds.includes(r.endToEndId!)));
    },
    createServiceRequest: async (serviceId, payload, endToEndId) => {
      calls.push(["createServiceRequest", serviceId, payload, endToEndId]);
      n += 1;
      const requestId = `SERV-REQ-${n}`; const entityId = `TRO-ZTEST-${n}`;
      requests.set(requestId, { requestId, serviceId, endToEndId, status: "DRAFT", entityId, payload, pendingPolls: 0 });
      return { requestId, pluginDetail: { entityId } };
    },
    submitServiceRequest: async requestId => { calls.push(["submitServiceRequest", requestId]); requests.get(requestId)!.status = "PENDING CONFIRMATION"; },
    pendingInstruction: async requestId => {
      calls.push(["pendingInstruction", requestId]);
      const r = requests.get(requestId)!;
      if (r.status !== "PENDING CONFIRMATION") return undefined;
      // shaped like an HSM order: our values, nested, under Zodia's own names
      return { request: {
        id: "3f6c1a52-8e1b-4f8e-9c6a-1d2e3f4a5b6c", type: "v0_CreateTransferOrder", targetDomainId: "dom-1",
        payload: { order: { accountId: r.payload.sender.value, ticker: r.payload.currencyId,
          destination: { kind: r.payload.destination.type, ref: r.payload.destination.value },
          amount: options.tamperAmount ? "999999" : r.payload.amount } },
      }, signature: "$$REPLACE$$" };
    },
    confirmAsMaker: async (requestId, instruction) => {
      calls.push(["confirmAsMaker", requestId, instruction]);
      const r = requests.get(requestId)!; r.status = "PENDING AUTHORISATION"; r.pendingPolls = 0;
    },
  };
  return { api, requests };
}

async function walletOf(api: ZodiaApi, address = ALICE) {
  const provider = await ZodiaCustodyProvider.create(CONFIG, api);
  return (await provider.resolveWallet(address))!;
}

const created = (calls: unknown[][]) => calls.filter(c => c[0] === "createServiceRequest");
const erc20 = new Interface(["function transfer(address,uint256)", "function mint(address,uint256)"]);
const HASH_1 = "0x" + "1".repeat(64);

describe("Zodia request signing", () => {

  test("signs company:request-id:timestamp:url:payload with the company RSA key, SHA256withRSA", () => {
    const client = new ZodiaClient(CONFIG);
    const url = "https://zodia.example.test/v3/api/servicedesk/create";
    const body = '{"serviceId":"0x0013-001","payload":{"name":"FUND123"}}';
    const h = client.requestHeaders(url, body);

    expect(h["company-identifier"]).toBe("ZTEST");
    expect(h["submitter-id"]).toBe("api-maker@example.com");
    expect(Number(h["request-timestamp"])).toBeGreaterThan(1.7e12);
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`ZTEST:${h["request-identifier"]}:${h["request-timestamp"]}:${url}:${body}`);
    expect(verifier.verify(company.publicKey, h.signature!, "base64")).toBe(true);
  });

  test("the maker signs the stable stringification of the instruction: keys sorted, nothing empty, ECDSA P-256 DER", () => {
    const client = new ZodiaClient(CONFIG);
    const signed = client.signAsMaker({ key2: "value2", key1: "value1", empty: "", nothing: null, list: [], nested: { b: 2, a: 1 } });
    expect(JSON.stringify(signed.request)).toBe('{"key1":"value1","key2":"value2","nested":{"a":1,"b":2}}');
    expect(ecdsaVerify("sha256", Buffer.from(stableStringify(signed.request)), { key: maker.publicKey, dsaEncoding: "der" }, Buffer.from(signed.signature, "base64"))).toBe(true);
    expect(stableStringify({ b: [3, 1, 2], a: "x" })).toBe('{"a":"x","b":[3,1,2]}');
  });

  test("sends the fields Zodia marks required: product and service ids on listing requests, hideZeroBalance on balances", async () => {
    const bodies: Record<string, unknown> = {};
    const realFetch = global.fetch;
    (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      bodies[new URL(url).pathname] = JSON.parse(String(init?.body));
      return { ok: true, status: 200, text: async () => '{"items":[]}' } as Response;
    });
    try {
      const client = new ZodiaClient(CONFIG);
      await client.serviceRequests({ serviceIds: ["0x0014-007", "0x0013-001"], requestIds: ["SERV-REQ-1"] });
      await client.walletBalances("ZTEST-NOBENF-ALICE");
    } finally {
      (global as any).fetch = realFetch;
    }
    expect(bodies["/v3/api/servicedesk/requests"]).toMatchObject({ productIds: ["0x0014", "0x0013"], serviceIds: ["0x0014-007", "0x0013-001"], requestIds: ["SERV-REQ-1"] });
    expect(bodies["/v3/api/custody/wallets/balance"]).toEqual({ walletId: "ZTEST-NOBENF-ALICE", hideZeroBalance: false });
  });
});

describe("ZodiaSigner: sendTransaction as a governed Service Desk transfer", () => {
  const savedHost = process.env.NETWORK_HOST;
  beforeAll(() => { delete process.env.NETWORK_HOST; });
  afterAll(() => { process.env.NETWORK_HOST = savedHost; });

  test("a native transfer to one of our wallets: created, submitted, confirmed as maker, then the chain hash", async () => {
    const calls: unknown[][] = [];
    const wallet = await walletOf(fakeZodia(calls).api);

    const tx = await runWithIdempotencyKey("ik-1", () => wallet.signer.sendTransaction({ to: BOB, value: 5n }));
    expect(tx.hash).toBe(HASH_1);
    const [, serviceId, payload, endToEndId] = created(calls)[0]!;
    expect(serviceId).toBe("0x0014-007");
    expect(payload).toEqual({
      amount: "5", sender: { type: "WALLETID", value: "ZTEST-NOBENF-ALICE" }, currency: "eth", currencyId: "eth-Seth",
      destination: { type: "WALLETID", value: "ZTEST-NOBENF-BOB" }, subtractFee: false,
    });
    expect(endToEndId).toBe(endToEndIdOf("ik-1", "ZTEST-NOBENF-ALICE", "eth-Seth", { type: "WALLETID", value: "ZTEST-NOBENF-BOB" }, "5"));
    const order = calls.map(c => c[0]).filter(c => !["serviceRequests", "transactions", "addresses", "currencies", "wallets"].includes(c as string));
    expect(order).toEqual(["createServiceRequest", "submitServiceRequest", "pendingInstruction", "confirmAsMaker"]);
  });

  test("the operation run again finds the request it raised instead of raising a second one", async () => {
    const calls: unknown[][] = [];
    const { api } = fakeZodia(calls);
    const wallet = await walletOf(api);
    const first = await runWithIdempotencyKey("ik-replay", () => wallet.signer.sendTransaction({ to: BOB, value: 7n }));
    const again = await runWithIdempotencyKey("ik-replay", () => wallet.signer.sendTransaction({ to: BOB, value: 7n }));
    expect(again.hash).toBe(first.hash);
    expect(created(calls)).toHaveLength(1);
  });

  test("a request left in DRAFT or awaiting the maker by a stopped process is taken up where it stopped", async () => {
    const calls: unknown[][] = [];
    const { api, requests } = fakeZodia(calls);
    const wallet = await walletOf(api);
    const endToEndId = endToEndIdOf("ik-crash", "ZTEST-NOBENF-ALICE", "eth-Seth", { type: "WALLETID", value: "ZTEST-NOBENF-BOB" }, "3");
    await api.createServiceRequest("0x0014-007", { amount: "3", sender: { type: "WALLETID", value: "ZTEST-NOBENF-ALICE" }, currency: "eth", currencyId: "eth-Seth", destination: { type: "WALLETID", value: "ZTEST-NOBENF-BOB" } }, endToEndId);
    expect([...requests.values()][0]!.status).toBe("DRAFT");

    const tx = await runWithIdempotencyKey("ik-crash", () => wallet.signer.sendTransaction({ to: BOB, value: 3n }));
    expect(tx.hash).toBe(HASH_1);
    expect(created(calls)).toHaveLength(1);
    expect(calls.map(c => c[0])).toEqual(expect.arrayContaining(["submitServiceRequest", "confirmAsMaker"]));
  });

  test("however long the authoriser takes, the request's own status decides: no adapter deadline", async () => {
    const wallet = await walletOf(fakeZodia([], { approveAfter: 40 }).api);
    const tx = await runWithIdempotencyKey("ik-slow", () => wallet.signer.sendTransaction({ to: BOB, value: 1n }));
    expect(tx.hash).toBe(HASH_1);
  });

  test("the maker confirms only an instruction that states what was submitted", async () => {
    const calls: unknown[][] = [];
    const wallet = await walletOf(fakeZodia(calls).api);
    await runWithIdempotencyKey("ik-bind", () => wallet.signer.sendTransaction({ to: BOB, value: 1n }));
    const confirmed = calls.find(c => c[0] === "confirmAsMaker")!;
    expect((confirmed[2] as ZodiaInstruction).request).toMatchObject({ type: "v0_CreateTransferOrder" });
  });

  test("an instruction stating something else is not confirmed: the request times out in Zodia and that ends the operation", async () => {
    const calls: unknown[][] = [];
    const wallet = await walletOf(fakeZodia(calls, { tamperAmount: true }).api);
    await expect(runWithIdempotencyKey("ik-tamper", () => wallet.signer.sendTransaction({ to: BOB, value: 1n })))
      .rejects.toThrow(/ended CONFIRMATION TIMEOUT \(maker confirmation withheld: the instruction does not state amount 1\)/);
    expect(calls.some(c => c[0] === "confirmAsMaker")).toBe(false);
  });

  test("a rejection by the authoriser surfaces as the failure it is", async () => {
    const wallet = await walletOf(fakeZodia([], { rejects: true }).api);
    await expect(runWithIdempotencyKey("ik-rej", () => wallet.signer.sendTransaction({ to: BOB, value: 1n }))).rejects.toThrow(/SERV-REQ-1 ended REJECTED BY AUTHORISER/);
  });

  test("transient Zodia errors (5xx, 429) are retried; a permanent refusal ends the wait at once, saying not to resubmit", async () => {
    const ok = await walletOf(fakeZodia([], { followErrors: [503, 429] }).api);
    expect((await runWithIdempotencyKey("ik-503", () => ok.signer.sendTransaction({ to: BOB, value: 1n }))).hash).toBe(HASH_1);

    const calls: unknown[][] = [];
    const refused = await walletOf(fakeZodia(calls, { followErrors: [403] }).api);
    await expect(runWithIdempotencyKey("ik-403", () => refused.signer.sendTransaction({ to: BOB, value: 1n })))
      .rejects.toThrow(/cannot be followed: Zodia \/v3\/api\/servicedesk\/requests answered 403.*do not resubmit/);
    expect(calls.filter(c => c[0] === "serviceRequests" && (c[1] as any).requestIds).length).toBe(1);
  });

  test("an ERC-20 transfer of a mapped token goes to a whitelisted beneficiary in base units", async () => {
    const calls: unknown[][] = [];
    const wallet = await walletOf(fakeZodia(calls).api);
    await runWithIdempotencyKey("ik-tok", () => wallet.signer.sendTransaction({ to: TMMF, data: erc20.encodeFunctionData("transfer", [BENEFICIARY, 1250n]) }));
    const [, , payload] = created(calls)[0]!;
    expect(payload).toMatchObject({ amount: "1250", currency: "TMMF", currencyId: "eth-Stmmf", destination: { type: "BENEFICIARYADDRESSID", value: "bnf-addr-7" } });
  });

  test("an ERC-20 plugin transfer completes on Zodia's record, without NETWORK_HOST (ethers Contract re-wraps the response)", async () => {
    const wallet = await walletOf(fakeZodia([]).api);
    const asset = { contractAddress: TMMF, decimals: 2, tokenStandard: "ERC20" };
    const result = await runWithIdempotencyKey("ik-plugin", () => new ERC20TokenStandard(wallet.provider, undefined).transfer(wallet, asset, BENEFICIARY, 1250n, console as any));
    expect(result).toEqual({ status: "success", transactionId: HASH_1, timestamp: expect.any(Number) });
  });

  test("a destination Zodia would refuse is refused before any request is raised", async () => {
    const calls: unknown[][] = [];
    const wallet = await walletOf(fakeZodia(calls).api);
    await expect(wallet.signer.sendTransaction({ to: STRANGER, value: 1n })).rejects.toThrow(/neither a wallet of this company nor an active outgoing beneficiary/);
    expect(created(calls)).toHaveLength(0);
  });

  test("what Zodia cannot do is refused, not mis-sent: deploy, mint, an unmapped token", async () => {
    const calls: unknown[][] = [];
    const wallet = await walletOf(fakeZodia(calls).api);
    await expect(wallet.signer.sendTransaction({ data: "0x6080" })).rejects.toThrow(/contract deployment is not supported/);
    await expect(wallet.signer.sendTransaction({ to: TMMF, data: erc20.encodeFunctionData("mint", [BOB, 1n]) })).rejects.toThrow(/mint\(address,uint256\) is not supported/);
    await expect(wallet.signer.sendTransaction({ to: STRANGER, data: erc20.encodeFunctionData("transfer", [BOB, 1n]) })).rejects.toThrow(/is not mapped to a Zodia currency/);
    await expect(wallet.signer.signMessage("hi")).rejects.toThrow(/raw message signing is not supported/);
    expect(created(calls)).toHaveLength(0);
  });
});

describe("Zodia chain reads without NETWORK_HOST", () => {
  const savedHost = process.env.NETWORK_HOST;
  beforeAll(() => { delete process.env.NETWORK_HOST; });
  afterAll(() => { process.env.NETWORK_HOST = savedHost; });

  test("chain id from the native currency; ERC20 scope; balances and decimals from Zodia", async () => {
    const calls: unknown[][] = [];
    const provider = await ZodiaCustodyProvider.create(CONFIG, fakeZodia(calls).api);
    expect(provider.chainReads.scope).toBe("erc20");
    const read = provider.chainReads.provider;
    expect((await read.getNetwork()).chainId).toBe(11155111n);
    expect(await read.getBalance(ALICE)).toBe(50000000000000000n);
    const token = new Contract(TMMF, ["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"], read);
    expect(await token.decimals()).toBe(2n);
    expect(await token.balanceOf(ALICE)).toBe(1250n);
    expect(await token.balanceOf(BOB)).toBe(0n);
    await expect(token.balanceOf(STRANGER)).rejects.toThrow(/Zodia holds no wallet for/);
  });

  test("block height costs no Zodia request, so readiness probes cannot spend the rate limit", async () => {
    const calls: unknown[][] = [];
    const provider = await ZodiaCustodyProvider.create(CONFIG, fakeZodia(calls).api);
    const before = calls.length;
    await provider.chainReads.provider.getBlockNumber();
    expect(calls.length).toBe(before);
  });

  test("reads Zodia cannot answer are refused, not guessed", async () => {
    const provider = await ZodiaCustodyProvider.create(CONFIG, fakeZodia([]).api);
    const read = provider.chainReads.provider;
    await expect(read.getTransactionCount(ALICE)).rejects.toThrow(/Zodia does not serve 'getTransactionCount'/);
    await expect(read.getTransactionReceipt("0x" + "ab".repeat(32))).rejects.toThrow(/receipts are known only for transfers this adapter settled/);
  });

  test("without a configured native currency, the chain is the one the company's EVM wallets are on", async () => {
    const provider = await ZodiaCustodyProvider.create({ ...CONFIG, native: undefined }, fakeZodia([]).api);
    expect(provider.native).toEqual({ currency: "eth", currencyId: "eth-Seth" });
  });
});

describe("Zodia chain reads with NETWORK_HOST set", () => {
  const savedHost = process.env.NETWORK_HOST;
  let rpc: http.Server; let rpcChainId: string; let rpcUrl: string;
  beforeAll(async () => {
    rpc = http.createServer((req, res) => {
      let raw = "";
      req.on("data", c => { raw += c; });
      req.on("end", () => {
        const reply = (r: { id: number; method: string }) => ({ jsonrpc: "2.0", id: r.id, result: r.method === "eth_chainId" ? rpcChainId : "0x1" });
        const body = JSON.parse(raw);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body)));
      });
    });
    await new Promise<void>(r => rpc.listen(0, "127.0.0.1", r));
    rpcUrl = `http://127.0.0.1:${(rpc.address() as AddressInfo).port}`;
  });
  afterAll(async () => { process.env.NETWORK_HOST = savedHost; await new Promise<void>(r => rpc.close(() => r())); });

  test("the configured RPC serves every read once it is on the chain of Zodia's native currency", async () => {
    rpcChainId = "0xaa36a7"; process.env.NETWORK_HOST = rpcUrl;
    const provider = await ZodiaCustodyProvider.create(CONFIG, fakeZodia([]).api);
    expect(provider.chainReads.scope).toBe("full");
    expect((await provider.chainReads.provider.getNetwork()).chainId).toBe(11155111n);
    (provider.chainReads.provider as any).destroy();
  });

  test("an RPC on another chain is refused at boot", async () => {
    rpcChainId = "0x1"; process.env.NETWORK_HOST = rpcUrl;
    await expect(ZodiaCustodyProvider.create(CONFIG, fakeZodia([]).api)).rejects.toThrow(/NETWORK_HOST is on chain 1, but Zodia currency eth-Seth is chain 11155111/);
  });
});

describe("Zodia configuration", () => {
  test("token currencies parse by contract address, and malformed entries are refused", () => {
    expect(parseTokenCurrencies(`${TMMF.toUpperCase().replace("0X", "0x")}=TMMF:eth-Stmmf`).get(TMMF)).toEqual({ currency: "TMMF", currencyId: "eth-Stmmf" });
    expect(() => parseTokenCurrencies("not-an-address=TMMF:eth-Stmmf")).toThrow(/0xContract=CODE:currency-id/);
    expect(() => parseTokenCurrencies(`${TMMF}=TMMF`)).toThrow(/CODE:currency-id/);
  });
});

custodyProviderConformance("zodia (in-memory Service Desk)", async () => {
  delete process.env.NETWORK_HOST;
  return { provider: await ZodiaCustodyProvider.create(CONFIG, fakeZodia([]).api), knownCustodyId: "ZTEST-NOBENF-BOB", knownAddress: ALICE };
});
