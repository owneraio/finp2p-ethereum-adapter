import { createVerify, generateKeyPairSync, verify as ecdsaVerify } from "crypto";
import { Interface } from "ethers";
import { ZodiaClient, ZodiaCustodyProvider, ZodiaApi, stableStringify } from "../src/integrations/custody/zodia";
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
  rpcUrl: "http://localhost:1",
  native: { currency: "ETH", currencyId: "eth-Seth" },
  tokens: parseTokenCurrencies(`${TMMF}=TMMF:eth-Stmmf`),
  pollIntervalMs: 1,
  maxPollIntervalMs: 1,
  requestTimeoutMs: 200,
  makerPollIntervalMs: 1,
};

/** Two wallets and one beneficiary; the authoriser approves, or rejects, out of band `approveAfter` polls later. */
function fakeZodia(calls: unknown[][], options: { approveAfter?: number; rejects?: boolean; neverApproves?: boolean } = {}) {
  const addresses = [
    { address: ALICE, walletId: "ZTEST-NOBENF-ALICE", currencyId: "eth-Seth" },
    { address: BOB, walletId: "ZTEST-NOBENF-BOB", currencyId: "eth-Seth" },
  ];
  const requests = new Map<string, ZodiaServiceRequest>();
  const transfers: ZodiaTransfer[] = [];
  let polls = 0; let n = 0;
  const api: ZodiaApi = {
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
      polls += 1;
      for (const r of requests.values()) {
        if (r.status === "PENDING AUTHORISATION" && !options.neverApproves && polls > (options.approveAfter ?? 2)) {
          r.status = options.rejects ? "REJECTED BY AUTHORISER" : "CONFIRMED";
          if (!options.rejects) transfers.push({ id: r.entityId!, status: "POSTED ON CHAIN", currency: "ETH", currencyId: "eth-Seth", ledgerRef: `0xhash-${r.entityId}` });
        }
      }
      return [...requests.values()].filter(r => !f.requestIds || f.requestIds.includes(r.requestId));
    },
    createServiceRequest: async (serviceId, payload, endToEndId) => {
      calls.push(["createServiceRequest", serviceId, payload, endToEndId]);
      n += 1;
      const requestId = `SERV-REQ-${n}`; const entityId = `TRO-ZTEST-${n}`;
      requests.set(requestId, { requestId, serviceId, endToEndId, status: "DRAFT", entityId });
      return { requestId, pluginDetail: { entityId } };
    },
    submitServiceRequest: async requestId => { calls.push(["submitServiceRequest", requestId]); requests.get(requestId)!.status = "PENDING CONFIRMATION"; },
    pendingInstruction: async requestId => {
      calls.push(["pendingInstruction", requestId]);
      return requests.get(requestId)!.status === "PENDING CONFIRMATION"
        ? { request: { targetDomainId: "dom-1", intentId: `intent-${requestId}`, type: "Propose" }, signature: "$$REPLACE$$" }
        : undefined;
    },
    confirmAsMaker: async (requestId, instruction) => { calls.push(["confirmAsMaker", requestId, instruction]); requests.get(requestId)!.status = "PENDING AUTHORISATION"; },
  };
  return api;
}

async function walletOf(api: ZodiaApi, address = ALICE) {
  const provider = await ZodiaCustodyProvider.create(CONFIG, api);
  const wallet = await provider.resolveWallet(address);
  (wallet!.signer as any).provider.getTransaction = async () => null; // no live RPC in test
  return wallet!;
}

const created = (calls: unknown[][]) => calls.filter(c => c[0] === "createServiceRequest");
const erc20 = new Interface(["function transfer(address,uint256)", "function mint(address,uint256)"]);

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

  test("a native transfer to one of our wallets: created, submitted, confirmed as maker, then the chain hash", async () => {
    const calls: unknown[][] = [];
    const wallet = await walletOf(fakeZodia(calls));

    const tx = await wallet.signer.sendTransaction({ to: BOB, value: 5n });
    expect(tx.hash).toBe("0xhash-TRO-ZTEST-1");
    const [, serviceId, payload, endToEndId] = created(calls)[0]!;
    expect(serviceId).toBe("0x0014-007");
    expect(payload).toEqual({
      amount: "5", sender: { type: "WALLETID", value: "ZTEST-NOBENF-ALICE" }, currency: "ETH", currencyId: "eth-Seth",
      destination: { type: "WALLETID", value: "ZTEST-NOBENF-BOB" }, subtractFee: false,
    });
    expect(endToEndId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(calls.filter(c => c[0] === "serviceRequests").every(c => (c[1] as { serviceIds?: string[] }).serviceIds?.includes("0x0014-007"))).toBe(true);
    const order = calls.map(c => c[0]).filter(c => c !== "serviceRequests" && c !== "transactions" && c !== "addresses");
    expect(order).toEqual(["createServiceRequest", "submitServiceRequest", "pendingInstruction", "confirmAsMaker"]);
  });

  test("the instruction it confirms is the one Zodia handed the maker", async () => {
    const calls: unknown[][] = [];
    const wallet = await walletOf(fakeZodia(calls));
    await wallet.signer.sendTransaction({ to: BOB, value: 1n });
    const confirmed = calls.find(c => c[0] === "confirmAsMaker")!;
    expect((confirmed[2] as ZodiaInstruction).request).toMatchObject({ intentId: "intent-SERV-REQ-1", type: "Propose" });
  });

  test("an ERC-20 transfer of a mapped token goes to a whitelisted beneficiary in base units", async () => {
    const calls: unknown[][] = [];
    const wallet = await walletOf(fakeZodia(calls));
    await wallet.signer.sendTransaction({ to: TMMF, data: erc20.encodeFunctionData("transfer", [BENEFICIARY, 1250n]) });
    const [, , payload] = created(calls)[0]!;
    expect(payload).toMatchObject({ amount: "1250", currency: "TMMF", currencyId: "eth-Stmmf", destination: { type: "BENEFICIARYADDRESSID", value: "bnf-addr-7" } });
  });

  test("a destination Zodia would refuse is refused before any request is raised", async () => {
    const calls: unknown[][] = [];
    const wallet = await walletOf(fakeZodia(calls));
    await expect(wallet.signer.sendTransaction({ to: STRANGER, value: 1n })).rejects.toThrow(/neither a wallet of this company nor an active outgoing beneficiary/);
    expect(created(calls)).toHaveLength(0);
  });

  test("what Zodia cannot do is refused, not mis-sent: deploy, mint, an unmapped token", async () => {
    const calls: unknown[][] = [];
    const wallet = await walletOf(fakeZodia(calls));
    await expect(wallet.signer.sendTransaction({ data: "0x6080" })).rejects.toThrow(/contract deployment is not supported/);
    await expect(wallet.signer.sendTransaction({ to: TMMF, data: erc20.encodeFunctionData("mint", [BOB, 1n]) })).rejects.toThrow(/mint\(address,uint256\) is not supported/);
    await expect(wallet.signer.sendTransaction({ to: STRANGER, data: erc20.encodeFunctionData("transfer", [BOB, 1n]) })).rejects.toThrow(/is not mapped to a Zodia currency/);
    await expect(wallet.signer.signMessage("hi")).rejects.toThrow(/raw message signing is not supported/);
    expect(created(calls)).toHaveLength(0);
  });

  test("a rejection by the authoriser surfaces as the failure it is", async () => {
    const wallet = await walletOf(fakeZodia([], { rejects: true }));
    await expect(wallet.signer.sendTransaction({ to: BOB, value: 1n })).rejects.toThrow(/SERV-REQ-1 ended REJECTED BY AUTHORISER/);
  });

  test("an authoriser who has not acted by the deadline leaves a pending request that must not be resubmitted", async () => {
    const wallet = await walletOf(fakeZodia([], { neverApproves: true }));
    await expect(wallet.signer.sendTransaction({ to: BOB, value: 1n })).rejects.toThrow(/still PENDING AUTHORISATION .* do not resubmit/);
  });
});

describe("Zodia configuration", () => {
  test("token currencies parse by contract address, and malformed entries are refused", () => {
    expect(parseTokenCurrencies(`${TMMF.toUpperCase().replace("0X", "0x")}=TMMF:eth-Stmmf`).get(TMMF)).toEqual({ currency: "TMMF", currencyId: "eth-Stmmf" });
    expect(() => parseTokenCurrencies("not-an-address=TMMF:eth-Stmmf")).toThrow(/0xContract=CODE:currency-id/);
    expect(() => parseTokenCurrencies(`${TMMF}=TMMF`)).toThrow(/CODE:currency-id/);
  });
});

custodyProviderConformance("zodia (in-memory Service Desk)", async () => ({
  provider: await ZodiaCustodyProvider.create(CONFIG, fakeZodia([])),
  knownCustodyId: "ZTEST-NOBENF-BOB",
  knownAddress: ALICE,
}));
