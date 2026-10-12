import { configuredRpcUrl, publicRpcUrl, resolveRpcUrl } from "../src/network-rpc";

describe("chain RPC resolution", () => {
  const saved = { host: process.env.NETWORK_HOST, auth: process.env.NETWORK_AUTH };
  afterEach(() => {
    process.env.NETWORK_HOST = saved.host;
    process.env.NETWORK_AUTH = saved.auth;
    if (saved.host === undefined) delete process.env.NETWORK_HOST;
    if (saved.auth === undefined) delete process.env.NETWORK_AUTH;
  });

  test("NETWORK_HOST wins over the public default, with NETWORK_AUTH folded in", () => {
    process.env.NETWORK_HOST = "https://rpc.example.test/v1";
    process.env.NETWORK_AUTH = "user:secret";
    expect(configuredRpcUrl()).toBe("https://user:secret@rpc.example.test/v1");
    expect(resolveRpcUrl(11155111)).toBe("https://user:secret@rpc.example.test/v1");
  });

  test("without NETWORK_HOST the chain's public RPC is used", () => {
    delete process.env.NETWORK_HOST;
    expect(configuredRpcUrl()).toBeUndefined();
    expect(resolveRpcUrl("11155111")).toBe("https://ethereum-sepolia-rpc.publicnode.com");
    expect(resolveRpcUrl(1n)).toBe("https://ethereum-rpc.publicnode.com");
    expect(resolveRpcUrl(296)).toBe("https://testnet.hashio.io/api");
  });

  test("chains outside the own table fall back to the Fireblocks chain table", () => {
    expect(publicRpcUrl(137)).toBe("https://polygon-rpc.com");
  });

  test("an unknown chain without NETWORK_HOST is refused at boot, naming the variable", () => {
    delete process.env.NETWORK_HOST;
    expect(() => resolveRpcUrl(999999999)).toThrow(/No public RPC endpoint is known for chain 999999999; set NETWORK_HOST/);
  });
});
