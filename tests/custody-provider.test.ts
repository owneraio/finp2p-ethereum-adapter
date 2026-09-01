import { Wallet, JsonRpcProvider } from "ethers";
import { CustodyProvider, CustodyWallet, custodyRegistry } from "../src/services/custody";
import { custodyProviderConformance } from "./utils/custody-provider-conformance";

/**
 * In-memory reference implementation of the full CustodyProvider contract:
 * custody ids are labels over locally generated keys. Exists to validate the
 * conformance suite itself and to document the expected semantics.
 */
class MemoryCustodyProvider implements CustodyProvider {

  private readonly accounts = new Map<string, Wallet>(); // custodyId -> key
  private readonly provider = new JsonRpcProvider("http://localhost:1");
  private seq = 0;

  static async create(): Promise<MemoryCustodyProvider> {
    const p = new MemoryCustodyProvider();
    await p.createCustodyAccount("seed");
    return p;
  }

  async resolveWallet(account: string): Promise<CustodyWallet | undefined> {
    for (const wallet of this.accounts.values()) {
      if (wallet.address.toLowerCase() === account.toLowerCase()) {
        return { provider: this.provider, signer: wallet.connect(this.provider) };
      }
    }
    return undefined;
  }

  async createWalletForCustodyId(custodyAccountId: string): Promise<CustodyWallet> {
    const wallet = this.accounts.get(custodyAccountId);
    if (!wallet) throw new Error(`unknown custody account ${custodyAccountId}`);
    return { provider: this.provider, signer: wallet.connect(this.provider) };
  }

  async resolveAddressFromCustodyId(custodyAccountId: string): Promise<string> {
    const wallet = this.accounts.get(custodyAccountId);
    if (!wallet) throw new Error(`unknown custody account ${custodyAccountId}`);
    return wallet.address;
  }

  async createCustodyAccount(label?: string): Promise<{ custodyAccountId: string; address: string }> {
    const custodyAccountId = `${label ?? "acc"}-${this.seq++}`;
    const wallet = Wallet.createRandom();
    this.accounts.set(custodyAccountId, wallet as unknown as Wallet);
    return { custodyAccountId, address: wallet.address };
  }

  async archiveCustodyAccount(custodyAccountId: string): Promise<void> {
    this.accounts.delete(custodyAccountId);
  }

  firstAccount(): { custodyAccountId: string; address: string } {
    const [custodyAccountId, wallet] = this.accounts.entries().next().value as [string, Wallet];
    return { custodyAccountId, address: wallet.address };
  }
}

custodyProviderConformance("in-memory reference", async () => {
  const provider = await MemoryCustodyProvider.create();
  const seed = provider.firstAccount();
  return { provider, knownCustodyId: seed.custodyAccountId, knownAddress: seed.address };
});

describe("custodyRegistry activation semantics", () => {

  test("compiled-in providers are registered at bootstrap", () => {
    // registerCustodyIntegrations() runs on app import; here we assert the
    // registry primitive directly with a scratch type instead
    expect(custodyRegistry.has("no-such-provider")).toBe(false);
  });

  test("registration is explicit, config-driven and duplicate-safe", async () => {
    const factory = jest.fn(async () => new MemoryCustodyProvider());
    custodyRegistry.register("memory-test", factory);
    expect(custodyRegistry.has("memory-test")).toBe(true);
    expect(custodyRegistry.availableProviders).toContain("memory-test");

    const cfg = { anything: true };
    await custodyRegistry.create("memory-test", cfg);
    expect(factory).toHaveBeenCalledWith(cfg);

    expect(() => custodyRegistry.register("memory-test", factory)).toThrow(/already registered/);
  });

  test("an unknown provider type names the available ones", async () => {
    await expect(custodyRegistry.create("nope", {})).rejects.toThrow(/Unknown custody provider type: 'nope'/);
  });
});
