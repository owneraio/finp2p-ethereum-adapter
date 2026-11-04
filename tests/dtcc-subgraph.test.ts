import { createServer, IncomingHttpHeaders, Server } from "http";
import { AddressInfo } from "net";
import { dtccSubgraphClient } from "../src/integrations/token-standards/dtcc-subgraph";

describe("dtccSubgraphClient", () => {
  const envKeys = ["SUBGRAPH_BASE_URL", "SUBGRAPH_AUTH", "SUBGRAPH_TLS_CERT", "SUBGRAPH_TLS_PRIVATE_KEY", "SUBGRAPH_TLS_CA"];
  let server: Server;
  let baseUrl: string;
  const requests: { url?: string; headers: IncomingHttpHeaders }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      requests.push({ url: req.url, headers: req.headers });
      req.resume();
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: { tokens: [] } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/subgraphs/name`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    requests.length = 0;
    for (const key of envKeys) delete process.env[key];
  });

  test("derives the subgraph URLs from SUBGRAPH_BASE_URL and sends SUBGRAPH_AUTH as basic auth", async () => {
    process.env.SUBGRAPH_BASE_URL = baseUrl;
    process.env.SUBGRAPH_AUTH = "user:secret";

    await dtccSubgraphClient().getTokenBySymbol("USDC");

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/subgraphs/name/token-factory-subgraph");
    expect(requests[0].headers.authorization).toBe(`Basic ${Buffer.from("user:secret").toString("base64")}`);
  });

  test("sends no Authorization header without SUBGRAPH_AUTH", async () => {
    process.env.SUBGRAPH_BASE_URL = baseUrl;

    await dtccSubgraphClient().getTokenBySymbol("USDC");

    expect(requests[0].headers.authorization).toBeUndefined();
  });

  test("requires SUBGRAPH_BASE_URL", () => {
    expect(() => dtccSubgraphClient()).toThrow("SUBGRAPH_BASE_URL is not set");
  });

  test("rejects a client certificate without its private key", () => {
    process.env.SUBGRAPH_BASE_URL = baseUrl;
    process.env.SUBGRAPH_TLS_CERT = "-----BEGIN CERTIFICATE-----";

    expect(() => dtccSubgraphClient()).toThrow("SUBGRAPH_TLS_CERT and SUBGRAPH_TLS_PRIVATE_KEY must be set together");
  });
});
