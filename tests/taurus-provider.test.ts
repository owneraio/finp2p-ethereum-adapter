import { createHash, createHmac, generateKeyPairSync, verify as ecdsaVerify } from "crypto";
import { Interface, parseUnits } from "ethers";
import { TaurusClient, decodeToContractCall, TaurusCustodyProvider } from "../src/integrations/custody/taurus";
import { TaurusAppConfig } from "../src/integrations/custody/taurus/config";
import { custodyProviderConformance } from "./utils/custody-provider-conformance";

const CONFIG: TaurusAppConfig = {
  host: "https://taurus.example.test",
  apiKey: "key-1",
  apiSecret: "a1b2c3d4e5f6",
  authScheme: "TDXV1",
  rpcUrl: "http://localhost:1",
  requestPollIntervalMs: 10,
  requestTimeoutMs: 1000,
};

describe("Taurus HMAC authorization header", () => {

  const parse = (header: string) => Object.fromEntries(
    header.split(" ").slice(1).map(kv => kv.split("=") as [string, string]).map(([k, ...v]) => [k, v.join("=")]),
  );

  test("TDXV1 hashes the string before the HMAC", () => {
    const client = new TaurusClient(CONFIG);
    const header = client.authorizationHeader("GET", "/api/rest/v1/wallets", "limit=5");
    expect(header.startsWith("TDXV1-HMAC-SHA256 ApiKey=key-1 ")).toBe(true);
    const { Nonce, Timestamp, Signature } = parse(header);
    const stringToHash = ["TDXV1", "key-1", Nonce, Timestamp, "GET", "taurus.example.test", "/api/rest/v1/wallets", "limit=5"].join(" ");
    const expected = createHmac("sha256", Buffer.from(CONFIG.apiSecret, "hex"))
      .update(createHash("sha256").update(stringToHash).digest("base64"))
      .digest("base64");
    expect(Signature).toBe(expected);
  });

  test("TPV1 signs the plain string; empty parts are omitted", () => {
    const client = new TaurusClient({ ...CONFIG, authScheme: "TPV1" });
    const header = client.authorizationHeader("POST", "/api/rest/v1/requests/outgoing", "", "application/json", '{"a":1}');
    const { Nonce, Timestamp, Signature } = parse(header);
    const stringToSign = ["TPV1", "key-1", Nonce, Timestamp, "POST", "taurus.example.test", "/api/rest/v1/requests/outgoing", "application/json", '{"a":1}'].join(" ");
    const expected = createHmac("sha256", Buffer.from(CONFIG.apiSecret, "hex")).update(stringToSign).digest("base64");
    expect(Signature).toBe(expected);
  });
});

describe("Taurus calldata translation (no raw signing in PROTECT)", () => {

  const erc20 = new Interface(["function transfer(address,uint256)", "function mint(address,uint256)"]);
  const TO = "0x1111111111111111111111111111111111111111";

  test("known token operations decode to structured contract calls", () => {
    const call = decodeToContractCall(erc20.encodeFunctionData("transfer", [TO, parseUnits("12.5", 2)]));
    expect(call.functionSignature).toBe("transfer(address,uint256)");
    expect(call.args).toEqual([TO, "1250"]);

    const mint = decodeToContractCall(erc20.encodeFunctionData("mint", [TO, 7n]));
    expect(mint.functionSignature).toBe("mint(address,uint256)");
    expect(mint.args).toEqual([TO, "7"]);
  });

  test("unknown selectors are refused instead of mis-sent", () => {
    expect(() => decodeToContractCall("0xdeadbeef")).toThrow(/not in the known token-operation ABI/);
  });
});

describe("Taurus approval signature (SDK-verified recipe)", () => {

  test("numeric-id sort, JSON hash array, P-256 raw r||s signature", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

    let approvedBody: any;
    const realFetch = global.fetch;
    (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      approvedBody = JSON.parse(String(init?.body));
      return { ok: true, status: 200, text: async () => "{}" } as Response;
    });
    try {
      const client = new TaurusClient({ ...CONFIG, operatorPrivateKey: pem });
      await client.approveRequests([
        { id: "10", status: "CREATED", metadata: { hash: "hash-ten" } },
        { id: "2", status: "CREATED", metadata: { hash: "hash-two" } },
      ]);
    } finally {
      (global as any).fetch = realFetch;
    }

    expect(approvedBody.ids).toEqual(["2", "10"]); // numeric, not lexicographic
    const hashesJson = JSON.stringify(["hash-two", "hash-ten"]);
    const ok = ecdsaVerify("sha256", Buffer.from(hashesJson, "utf-8"),
      { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(approvedBody.signature, "base64"));
    expect(ok).toBe(true);
    expect(Buffer.from(approvedBody.signature, "base64")).toHaveLength(64); // raw r||s
  });
});

describe("TaurusSigner request lifecycle (mocked backend)", () => {

  const FROM = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const TOKEN = "0xB35aC1D4E76dfA0b3Da44714eFf45305ed6A9e00";
  const erc20 = new Interface(["function transfer(address,uint256)"]);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const OPERATOR_PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  function lifecycleBackend(opts: { whitelisted?: boolean } = {}) {
    const statuses = ["APPROVING", "HSM_SIGNED", "BROADCASTING"];
    let polls = 0;
    const calls: string[] = [];
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push(`${init?.method ?? "GET"} ${path}`);
      const reply = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) } as Response);
      if (path === "/api/rest/v1/addresses") return reply({ result: [{ id: "42", walletId: "7", address: FROM }] });
      if (path === "/api/rest/v1/whitelists/addresses") {
        return reply({ result: opts.whitelisted === false ? [] : [{ id: "8", signedAddress: { address: { address: TOKEN } } }] });
      }
      if (path === "/api/rest/v1/requests/outgoing/contracts/call") {
        return reply({ result: { id: "77", status: "CREATED", metadata: { hash: "req-hash" } } });
      }
      if (path === "/api/rest/v1/requests/approve") return reply({ signedRequests: "1" });
      if (path === "/api/rest/v1/requests/77") {
        const status = statuses[Math.min(polls++, statuses.length - 1)];
        return reply({ result: { id: "77", status, ...(status === "BROADCASTING" ? { transactionHash: "0xdeadbeef" } : {}) } });
      }
      return { ok: false, status: 404, text: async () => "{}" } as Response;
    });
    return { fetchMock, calls };
  }

  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; });

  test("sendTransaction: create contract-call request -> approve -> poll to tx hash", async () => {
    const { fetchMock, calls } = lifecycleBackend();
    (global as any).fetch = fetchMock;
    const provider = await TaurusCustodyProvider.create({ ...CONFIG, operatorPrivateKey: OPERATOR_PEM });
    const wallet = await provider.resolveWallet(FROM);
    (wallet!.provider as any).getTransaction = async () => null; // no live RPC in test
    (wallet!.signer as any).provider.getTransaction = async () => null;

    const tx = await wallet!.signer.sendTransaction({ to: TOKEN, data: erc20.encodeFunctionData("transfer", [FROM, 5n]) });
    expect(tx.hash).toBe("0xdeadbeef");
    expect(calls).toContain("POST /api/rest/v1/requests/outgoing/contracts/call");
    expect(calls).toContain("POST /api/rest/v1/requests/approve");
  });

  test("a non-whitelisted destination is refused before any request is created", async () => {
    const { fetchMock, calls } = lifecycleBackend({ whitelisted: false });
    (global as any).fetch = fetchMock;
    const provider = await TaurusCustodyProvider.create({ ...CONFIG, operatorPrivateKey: OPERATOR_PEM });
    const wallet = await provider.resolveWallet(FROM);
    await expect(wallet!.signer.sendTransaction({ to: TOKEN, data: erc20.encodeFunctionData("transfer", [FROM, 5n]) }))
      .rejects.toThrow(/not whitelisted in PROTECT/);
    expect(calls.filter(c => c.includes("/requests/")).length).toBe(0);
  });
});

// ---- conformance against a mocked PROTECT backend --------------------------

const ADDR_1 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function mockBackend() {
  const addresses = [{ id: "42", walletId: "7", address: ADDR_1 }];
  return jest.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const body =
      path === "/api/rest/v1/addresses" ? { result: addresses } :
        path === "/api/rest/v1/addresses/42" ? { result: addresses[0] } :
          undefined;
    return {
      ok: body !== undefined,
      status: body ? 200 : 404,
      text: async () => JSON.stringify(body ?? { error: "not found" }),
    } as Response;
  });
}

describe("TaurusCustodyProvider over a mocked backend", () => {
  const realFetch = global.fetch;
  beforeAll(() => { (global as any).fetch = mockBackend(); });
  afterAll(() => { (global as any).fetch = realFetch; });

  custodyProviderConformance("taurus (mocked PROTECT)", async () => ({
    provider: await TaurusCustodyProvider.create(CONFIG),
    knownCustodyId: "42",
    knownAddress: ADDR_1,
  }));
});
