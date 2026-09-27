import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";
import { pooledSigner, resetSignerPool } from "../src/integrations/signer-pool";
import { AssetRecord, WhitelistParty, supportsWhitelisting } from "@owneraio/finp2p-ethereum-adapter-contract";

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

  describe("by ledger", () => {
    const onStellar = { name: "stellar instance" } as any;
    const onChain = { name: "configured-chain instance" } as any;

    beforeAll(() => {
      tokenStandardRegistry.register("LEDGER_TEST", onChain);
      tokenStandardRegistry.register("LEDGER_TEST", onStellar, "holder-reservation", "stellar:testnet");
    });

    test("the same standard name resolves to a different instance per ledger", () => {
      expect(tokenStandardRegistry.resolve("LEDGER_TEST", "stellar:testnet")).toBe(onStellar);
      expect(tokenStandardRegistry.resolve("ledger_test", "stellar:testnet")).toBe(onStellar);
      expect(tokenStandardRegistry.holdModel("LEDGER_TEST", "stellar:testnet")).toBe("holder-reservation");
    });

    test("a record without a ledger resolves exactly as before", () => {
      expect(tokenStandardRegistry.resolve("LEDGER_TEST")).toBe(onChain);
      expect(tokenStandardRegistry.holdModel("LEDGER_TEST")).toBe("escrow-transfer");
    });

    test("a ledger nobody registered for is unknown, and says so", () => {
      expect(tokenStandardRegistry.has("LEDGER_TEST", "solana:devnet")).toBe(false);
      expect(() => tokenStandardRegistry.resolve("LEDGER_TEST", "solana:devnet")).toThrow(/'LEDGER_TEST' on solana:devnet/);
      expect(() => tokenStandardRegistry.register("LEDGER_TEST", impl, "escrow-transfer", "stellar:testnet")).toThrow(/already registered for stellar:testnet/);
    });

    test("available standards name the ledger for everything off the configured chain", () => {
      expect(tokenStandardRegistry.availableStandards).toEqual(expect.arrayContaining(["LEDGER_TEST", "stellar:testnet/LEDGER_TEST"]));
    });
  });

  describe("a plugin that signs bytes", () => {
    // What a Stellar or Solana plugin needs from a wallet: an address and a
    // signature over bytes. Nothing ethers-shaped is built anywhere in here.
    type MessageSigner = { address: string; sign(message: Uint8Array): Promise<Uint8Array> };
    const signed: string[] = [];
    const holder: MessageSigner = { address: "GHOLDER", sign: async () => { signed.push("holder"); return new Uint8Array(64); } };
    // `ledger` on AssetRecord arrives with adapter-contract 0.28.13; the host must build against 0.28.12 until then.
    const asset: AssetRecord & { ledger: string } = { contractAddress: "TOK:GISSUER", decimals: 7, tokenStandard: "BYTES_TEST", ledger: "stellar:testnet" };

    const plugin = {
      transfer: async (wallet: MessageSigner) => { await wallet.sign(new Uint8Array(32)); return { status: "success", transactionId: "tx", timestamp: 0 }; },
      isWhitelisted: async () => false,
      whitelist: async (_asset: AssetRecord, party: WhitelistParty, _logger: unknown, wallet?: MessageSigner) => {
        if (!wallet || wallet.address !== party.address) return { status: "failure", reason: `a trustline is signed by the holder ${party.address}` };
        await wallet.sign(new Uint8Array(32));
        return { status: "success", transactionId: "trustline", timestamp: 0 };
      },
      dewhitelist: async () => ({ status: "success", transactionId: "tx", timestamp: 0 }),
    } as any;

    beforeAll(() => tokenStandardRegistry.register("BYTES_TEST", plugin, "escrow-transfer", "stellar:testnet"));

    test("resolves by ledger and standard and is driven with its own wallet type", async () => {
      const standard = tokenStandardRegistry.resolve<typeof plugin>("BYTES_TEST", asset.ledger);
      expect(standard).toBe(plugin);
      await expect(standard.transfer(holder, asset, "GTO", 1n, console)).resolves.toEqual({ status: "success", transactionId: "tx", timestamp: 0 });
      expect(signed).toEqual(["holder"]);
    });

    test("whitelisting is exercised with the holder's wallet and refuses without it", async () => {
      const standard = tokenStandardRegistry.resolve<typeof plugin>("BYTES_TEST", "stellar:testnet");
      expect(supportsWhitelisting(standard)).toBe(true);
      const party: WhitelistParty = { address: holder.address, finId: "fin-1", role: "destination" };
      await expect(standard.whitelist(asset, party, console)).resolves.toEqual({ status: "failure", reason: "a trustline is signed by the holder GHOLDER" });
      await expect(standard.whitelist(asset, party, console, holder)).resolves.toEqual({ status: "success", transactionId: "trustline", timestamp: 0 });
      expect(signed).toEqual(["holder", "holder"]);
    });

    test("is not found on the configured chain", () => {
      expect(tokenStandardRegistry.has("BYTES_TEST")).toBe(false);
    });
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
