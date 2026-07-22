import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";
import { pooledSigner, resetSignerPool } from "../src/integrations/signer-pool";

const impl = {} as any;

describe("tokenStandardRegistry", () => {

  test("register / resolve / has; unknown throws; case-insensitive", () => {
    tokenStandardRegistry.register("REGISTRY_TEST", impl);
    expect(tokenStandardRegistry.resolve("REGISTRY_TEST")).toBe(impl);
    expect(tokenStandardRegistry.resolve("registry_test")).toBe(impl); // case-insensitive
    expect(tokenStandardRegistry.has("REGISTRY_TEST")).toBe(true);
    expect(() => tokenStandardRegistry.resolve("NEVER_REGISTERED")).toThrow(/Unknown token standard/);
  });

  test("re-registering the same standard throws", () => {
    tokenStandardRegistry.register("DUP_TEST", impl);
    expect(() => tokenStandardRegistry.register("DUP_TEST", impl)).toThrow(/already registered/);
  });
});

describe("pooledSigner", () => {

  const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const RPC = "http://localhost:1";

  beforeEach(() => resetSignerPool());

  test("same key yields the same NonceManager across callers", () => {
    expect(pooledSigner(RPC, KEY)).toBe(pooledSigner(RPC, KEY));
  });

  test("key normalization: 0x-prefix and case do not split the pool", () => {
    const bare = KEY.slice(2);
    expect(pooledSigner(RPC, KEY)).toBe(pooledSigner(RPC, bare));
    expect(pooledSigner(RPC, KEY)).toBe(pooledSigner(RPC, KEY.toUpperCase().replace("0X", "0x")));
  });

  test("different keys get distinct managers", () => {
    const other = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    expect(pooledSigner(RPC, KEY)).not.toBe(pooledSigner(RPC, other));
  });
});
