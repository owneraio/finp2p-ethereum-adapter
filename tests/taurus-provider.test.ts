import { createHash, createHmac } from "crypto";
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
