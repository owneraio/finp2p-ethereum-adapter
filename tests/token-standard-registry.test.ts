import { tokenStandardRegistry } from "../src/services/direct/token-standards/registry";
import { pooledSigner, resetSignerPool } from "../src/integrations/signer-pool";

const impl = {} as any;

describe("tokenStandardRegistry erc20Compatible trait", () => {

  test("standards registered with erc20Compatible report it; others default to false", () => {
    tokenStandardRegistry.register("COMPAT_TEST", impl, { erc20Compatible: true });
    tokenStandardRegistry.register("REGISTRY_TEST", impl);
    expect(tokenStandardRegistry.isErc20Compatible("COMPAT_TEST")).toBe(true);
    expect(tokenStandardRegistry.isErc20Compatible("compat_test")).toBe(true); // case-insensitive
    expect(tokenStandardRegistry.isErc20Compatible("REGISTRY_TEST")).toBe(false);
    expect(tokenStandardRegistry.isErc20Compatible("NEVER_REGISTERED")).toBe(false);
  });

  test("resolve and has still work through the registration wrapper", () => {
    expect(tokenStandardRegistry.resolve("COMPAT_TEST")).toBe(impl);
    expect(tokenStandardRegistry.has("COMPAT_TEST")).toBe(true);
    expect(() => tokenStandardRegistry.resolve("NEVER_REGISTERED")).toThrow(/Unknown token standard/);
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
