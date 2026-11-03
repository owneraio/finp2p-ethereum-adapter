import winston from "winston";
import { JsonRpcProvider } from "ethers";
import { ReleaseType } from "@owneraio/finp2p-ethereum-adapter-contract";
import { InMemoryOrderJournal, WisdomTreeTokenStandard } from "@owneraio/finp2p-ethereum-wisdomtree-connect";
import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";
import { registerTokenStandards } from "../src/integrations/token-standards/register";
import { wisdomTreeSettings } from "../src/integrations/token-standards/wisdomtree-settings";
import { CustodyTokenService } from "../src/services/custody/token-service";
import { PgIssuerOrderJournal } from "../src/services/custody/issuer-order-journal";

const ESCROW_ADDRESS = "0x" + "ee".repeat(20);
const INVESTOR_ADDRESS = "0x" + "11".repeat(20);
const INVESTOR_FINID = "02" + "aa".repeat(32);
const TOKEN = "0x0b2517eef907389F36fd87Add36E9118d364BD67";

const logger = winston.createLogger({ transports: [new winston.transports.Console({ silent: true })] });

const wallet = (address: string) => ({ signer: { getAddress: async () => address } }) as any;

const inFlight = { status: "failure", reason: "order ref1 is Order Valid", submitted: true } as const;
const done = { status: "success", transactionId: "0xdelivery", timestamp: 1793043312 } as const;

const issuerApi = {
  issueByApi: jest.fn(),
  redeemByApi: jest.fn(),
  mint: jest.fn(),
  burn: jest.fn(),
  release: jest.fn(),
};
tokenStandardRegistry.register("ISSUER_API_TEST", issuerApi as any);
tokenStandardRegistry.register("ISSUER_API_RESERVING", issuerApi as any, "holder-reservation");

function service(backoff = { firstMs: 1, maxMs: 2, deadlineMs: 60_000 }, tokenStandard = "ISSUER_API_TEST"): CustodyTokenService {
  const assetStore = {
    getAsset: async () => ({ contract_address: TOKEN, decimals: 18, token_standard: tokenStandard }),
    saveAsset: async () => {},
  } as any;
  const accountMapping = {
    resolveAccount: async (finId: string) => (finId === INVESTOR_FINID ? INVESTOR_ADDRESS : undefined),
  } as any;
  return new CustodyTokenService(logger, {} as any, wallet(ESCROW_ADDRESS), {} as any, accountMapping, assetStore, undefined, undefined, backoff);
}

const ASSET = { assetId: "bank-us:102:asset-1", assetType: "finp2p" } as any;
const INVESTOR = { finId: INVESTOR_FINID } as any;
const EX_CTX = { planId: "bank-us:106:plan-1", sequence: 1 } as any;

beforeEach(() => jest.resetAllMocks());

describe("CustodyTokenService with an issuer-API standard", () => {

  test("issue asks the issuer under the idempotency key, with no issuer key, until the order settles", async () => {
    issuerApi.issueByApi.mockResolvedValueOnce(inFlight).mockResolvedValueOnce(inFlight).mockResolvedValueOnce(done);

    const receipt = await service().issue("ik-1", ASSET, INVESTOR, "5", EX_CTX);

    expect(receipt).toMatchObject({ type: "success", receipt: { id: "0xdelivery", operationType: "issue", quantity: "5", timestamp: 1793043312 } });
    expect(issuerApi.issueByApi).toHaveBeenCalledTimes(3);
    for (const [asset, to, amount, operationId] of issuerApi.issueByApi.mock.calls) {
      expect(asset).toMatchObject({ contractAddress: TOKEN, decimals: 18 });
      expect(to).toBe(INVESTOR_ADDRESS);
      expect(amount).toBe(5n * 10n ** 18n);
      expect(operationId).toBe("ik-1");
    }
    expect(issuerApi.mint).not.toHaveBeenCalled();
  });

  test("an issue the issuer refused or failed ends at once", async () => {
    issuerApi.issueByApi.mockResolvedValue({ status: "failure", reason: "WisdomTree Connect refused the order", submitted: false });

    const receipt = await service().issue("ik-1", ASSET, INVESTOR, "5", EX_CTX);

    expect(receipt).toMatchObject({ type: "failure" });
    expect(issuerApi.issueByApi).toHaveBeenCalledTimes(1);
  });

  test("an order still in flight at the deadline fails, left for manual handling", async () => {
    issuerApi.issueByApi.mockResolvedValue(inFlight);

    const receipt = await service({ firstMs: 5, maxMs: 5, deadlineMs: 12 }).issue("ik-1", ASSET, INVESTOR, "5", EX_CTX);

    expect(receipt).toMatchObject({ type: "failure" });
    expect(JSON.stringify(receipt)).toMatch(/order ref1 is Order Valid; no final answer within 0 min, so the order is left for manual handling/);
    expect(issuerApi.issueByApi.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(issuerApi.issueByApi.mock.calls.length).toBeLessThanOrEqual(4);
  });

  test("a held redeem asks the issuer to take the units from the escrow, under the idempotency key", async () => {
    issuerApi.redeemByApi.mockResolvedValueOnce(inFlight).mockResolvedValueOnce({ ...done, transactionId: "0xburn" });

    const receipt = await service().redeem("ik-2", "nonce", INVESTOR, ASSET, "6", "op-1", undefined as any, EX_CTX);

    expect(receipt).toMatchObject({ type: "success", receipt: { id: "0xburn", operationType: "redeem" } });
    expect(issuerApi.redeemByApi).toHaveBeenCalledTimes(2);
    const [, from, amount, operationId, , opCtx] = issuerApi.redeemByApi.mock.calls[0];
    expect(from).toBe(ESCROW_ADDRESS);
    expect(amount).toBe(6n * 10n ** 18n);
    expect(operationId).toBe("ik-2");
    expect(opCtx).toMatchObject({ operationId: "op-1", releaseType: ReleaseType.Redeem });
    expect(issuerApi.burn).not.toHaveBeenCalled();
    expect(issuerApi.release).not.toHaveBeenCalled();
  });

  test("a held redeem is refused when the standard's holds stay on the holder", async () => {
    const receipt = await service(undefined, "ISSUER_API_RESERVING").redeem("ik-2", "nonce", INVESTOR, ASSET, "6", "op-1", undefined as any, EX_CTX);

    expect(receipt).toMatchObject({ type: "failure" });
    expect(JSON.stringify(receipt)).toMatch(/takes held units from the escrow, but its holds stay on the holder's account/);
    expect(issuerApi.redeemByApi).not.toHaveBeenCalled();
    expect(issuerApi.release).not.toHaveBeenCalled();
  });

  test("a direct redeem asks the issuer to take the units from the holder", async () => {
    issuerApi.redeemByApi.mockResolvedValue(done);

    await service().redeem("ik-3", "nonce", INVESTOR, ASSET, "6", undefined, undefined as any, EX_CTX);

    expect(issuerApi.redeemByApi.mock.calls[0][1]).toBe(INVESTOR_ADDRESS);
  });
});

describe("wisdomTreeSettings", () => {
  const env = {
    WISDOMTREE_CONNECT_BASE_URL: "https://api.sandbox.wisdomtreeconnect.com",
    WISDOMTREE_CONNECT_CLIENT_ID: "client",
    WISDOMTREE_CONNECT_CLIENT_SECRET: "secret",
    WISDOMTREE_CONNECT_USERNAME: "ops@example.com",
    WISDOMTREE_CONNECT_PASSWORD: "p&ss",
    WISDOMTREE_PRODUCTS: JSON.stringify({ [TOKEN]: { exchangeCode: "WTGXX", blockchain: "Ethereum Sepolia", settlementCurrency: "USD" } }),
  };

  test("is off without a Connect base URL", () => {
    expect(wisdomTreeSettings({})).toBeUndefined();
  });

  test("reads the Connect credentials, products and waits", () => {
    expect(wisdomTreeSettings({ ...env, WISDOMTREE_WAIT_SECONDS: "900", WISDOMTREE_POLL_INTERVAL_MS: "30000" })).toEqual({
      connect: { baseUrl: env.WISDOMTREE_CONNECT_BASE_URL, clientId: "client", clientSecret: "secret", username: "ops@example.com", password: "p&ss" },
      products: { [TOKEN]: { exchangeCode: "WTGXX", blockchain: "Ethereum Sepolia", settlementCurrency: "USD" } },
      organizationGuid: undefined,
      waitSeconds: 900,
      pollIntervalMs: 30000,
    });
  });

  test("refuses missing credentials, bad products and bad numbers", () => {
    expect(() => wisdomTreeSettings({ ...env, WISDOMTREE_CONNECT_PASSWORD: "" })).toThrow(/WISDOMTREE_CONNECT_PASSWORD is not/);
    expect(() => wisdomTreeSettings({ ...env, WISDOMTREE_PRODUCTS: "{" })).toThrow(/not JSON/);
    expect(() => wisdomTreeSettings({ ...env, WISDOMTREE_PRODUCTS: "{}" })).toThrow(/must map token addresses/);
    expect(() => wisdomTreeSettings({ ...env, WISDOMTREE_PRODUCTS: JSON.stringify({ [TOKEN]: { exchangeCode: "WTGXX" } }) })).toThrow(/has no blockchain/);
    expect(() => wisdomTreeSettings({ ...env, WISDOMTREE_PRODUCTS: JSON.stringify({ [TOKEN]: { exchangeCode: "WTGXX", blockchain: "Ethereum Sepolia", settlementCurrency: "USD", orderType: "instant" } }) })).toThrow(/orderType/);
    expect(() => wisdomTreeSettings({ ...env, WISDOMTREE_WAIT_SECONDS: "-1" })).toThrow(/positive integer/);
  });

  test("registers WISDOMTREE over the ERC20 standard when configured", () => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    delete process.env.ASSET_ISSUER_PRIVATE_KEY;
    try {
      registerTokenStandards({
        logger,
        rpcUrl: undefined,
        readProvider: new JsonRpcProvider("http://localhost:1"),
        chainReadScope: "full",
        issuerOrderJournal: new InMemoryOrderJournal(),
      } as any);
      expect(tokenStandardRegistry.resolve("WISDOMTREE")).toBeInstanceOf(WisdomTreeTokenStandard);
    } finally {
      process.env = saved;
    }
  });
});

describe("PgIssuerOrderJournal", () => {
  const creating = { state: "creating", request: "Purchase|Ethereum Sepolia|WTGXX|0x0b25|0x9a22|5", createStartedAt: 5 };

  test("creates an entry only if none exists, and returns the stored one otherwise", async () => {
    const stored = { ...creating, createStartedAt: 1 };
    const query = jest.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ entry: stored }] });
    const journal = new PgIssuerOrderJournal({ query } as any, "ledger");

    expect(await journal.create("ik-1", creating)).toEqual({ record: creating, created: true });
    expect(await journal.create("ik-1", creating)).toEqual({ record: stored, created: false });

    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO ledger\.issuer_order_journal[\s\S]*ON CONFLICT \(operation_id\) DO NOTHING/);
    expect(query.mock.calls[0][1]).toEqual(["ik-1", JSON.stringify(creating)]);
    expect(query.mock.calls[2][0]).toContain("FROM ledger.issuer_order_journal");
  });

  test("moves an entry only from the expected state of the same request", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
    const journal = new PgIssuerOrderJournal({ query } as any, "ledger");
    const placed = { ...creating, state: "placed", orderReference: "ref1" };

    expect(await journal.transition("ik-1", "creating", placed)).toBe(true);
    expect(await journal.transition("ik-1", "creating", placed)).toBe(false);

    expect(query.mock.calls[0][0]).toMatch(/UPDATE ledger\.issuer_order_journal[\s\S]*WHERE operation_id = \$1 AND entry->>'state' = \$3 AND entry->>'request' = \$4/);
    expect(query.mock.calls[0][1]).toEqual(["ik-1", JSON.stringify(placed), "creating", creating.request]);
  });

  test("gives a burn to its first claimant and reports that owner to every later one", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rows: [{ operation_id: "ik-1" }] });
    const journal = new PgIssuerOrderJournal({ query } as any, "ledger");

    expect(await journal.claimBurn("eip155:11155111:0x0b25:0xburn:3", "ik-2")).toBe("ik-1");

    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO ledger\.issuer_burn_claim[\s\S]*ON CONFLICT \(burn_id\) DO NOTHING/);
    expect(query.mock.calls[0][1]).toEqual(["eip155:11155111:0x0b25:0xburn:3", "ik-2"]);
    expect(query.mock.calls[1][0]).toContain("FROM ledger.issuer_burn_claim WHERE burn_id = $1");
  });
});
