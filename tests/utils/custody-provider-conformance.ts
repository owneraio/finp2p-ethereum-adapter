import { CustodyProvider } from "../../src/services/custody";

export interface ConformanceFixture {
  /** fresh provider under test */
  provider: CustodyProvider;
  /** a custody account id the backend already knows, when the provider supports id-based methods */
  knownCustodyId?: string;
  /** an address the backend already knows (resolveWallet must find it) */
  knownAddress?: string;
}

const UNKNOWN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

/**
 * The parts of the CustodyProvider contract every implementation must honor.
 * Optional methods the provider does not declare are skipped, mirroring how
 * the adapter capability-probes them. Run it in CI against the in-memory
 * reference provider, and against a real backend behind its credentials envs.
 */
export function custodyProviderConformance(name: string, build: () => Promise<ConformanceFixture>): void {
  describe(`CustodyProvider conformance: ${name}`, () => {

    let fixture: ConformanceFixture;
    beforeAll(async () => { fixture = await build(); });

    test("resolveWallet of an unknown address resolves to undefined, never throws", async () => {
      await expect(fixture.provider.resolveWallet(UNKNOWN_ADDRESS)).resolves.toBeUndefined();
    });

    test("resolveWallet of a known address returns a wallet signing as that address", async () => {
      if (!fixture.knownAddress) return;
      const wallet = await fixture.provider.resolveWallet(fixture.knownAddress);
      expect(wallet).toBeDefined();
      expect((await wallet!.signer.getAddress()).toLowerCase()).toBe(fixture.knownAddress.toLowerCase());
      expect(wallet!.provider).toBeDefined();
    });

    test("a custody id resolves to the same address its fabricated wallet signs as", async () => {
      const { provider, knownCustodyId } = fixture;
      if (!knownCustodyId || !provider.createWalletForCustodyId || !provider.resolveAddressFromCustodyId) return;
      const address = await provider.resolveAddressFromCustodyId(knownCustodyId);
      const wallet = await provider.createWalletForCustodyId(knownCustodyId);
      expect((await wallet.signer.getAddress()).toLowerCase()).toBe(address.toLowerCase());
    });

    test("a created custody account resolves both ways and can be archived", async () => {
      const { provider } = fixture;
      if (!provider.createCustodyAccount) return;
      const { custodyAccountId, address } = await provider.createCustodyAccount("conformance");
      expect(custodyAccountId).toBeTruthy();
      expect(address).toBeTruthy();
      if (provider.resolveAddressFromCustodyId) {
        expect((await provider.resolveAddressFromCustodyId(custodyAccountId)).toLowerCase()).toBe(address.toLowerCase());
      }
      const wallet = await provider.resolveWallet(address);
      expect(wallet).toBeDefined();
      await provider.archiveCustodyAccount?.(custodyAccountId);
    });
  });
}
