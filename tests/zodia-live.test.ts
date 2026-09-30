import { Wallet } from "ethers";
import { ZodiaClient, ZodiaCustodyProvider } from "../src/integrations/custody/zodia";
import { createZodiaAppConfig } from "../src/integrations/custody/zodia/config";
import { custodyProviderConformance } from "./utils/custody-provider-conformance";

/**
 * The CustodyProvider contract against a live Zodia company, read-only: no
 * service request is ever raised. Runs only with ZODIA_* credentials, e.g.
 *   set -a; . ./.env.zodia; set +a; npm run test:zodia
 * Zodia allows 128 requests a day per endpoint, so this suite stays small.
 */
const live = !!process.env.ZODIA_COMPANY_ID && !!process.env.ZODIA_SUBMITTER_ID;
const rpcUrl = process.env.ZODIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

async function liveFixture() {
  const config = createZodiaAppConfig(rpcUrl);
  const client = new ZodiaClient(config);
  const provider = await ZodiaCustodyProvider.create(config, client);
  const [first] = await client.addresses({ currenciesIds: [provider.native.currencyId] });
  if (!first) throw new Error(`the Zodia company has no ${provider.native.currencyId} wallet address to test against`);
  return { client, provider, first };
}

if (!live) {
  test.skip("Zodia live suite needs ZODIA_COMPANY_ID, ZODIA_SUBMITTER_ID and the key paths", () => undefined);
} else {
  let fixture: Awaited<ReturnType<typeof liveFixture>>;
  beforeAll(async () => { fixture = await liveFixture(); });

  custodyProviderConformance("zodia (live)", async () => {
    const { provider, first } = fixture ?? await liveFixture();
    return { provider, knownCustodyId: first.walletId, knownAddress: first.address };
  });

  describe("Zodia live: what the adapter relies on", () => {

    test("every wallet address the company holds resolves to a signer at that address and back to its wallet", async () => {
      const addresses = await fixture.client.addresses({ currenciesIds: [fixture.provider.native.currencyId] });
      expect(addresses.length).toBeGreaterThan(0);
      for (const a of addresses) {
        const wallet = await fixture.provider.resolveWallet(a.address);
        expect((await wallet!.signer.getAddress()).toLowerCase()).toBe(a.address.toLowerCase());
        expect((await fixture.provider.resolveAddressFromCustodyId(a.walletId)).toLowerCase()).toBe(a.address.toLowerCase());
      }
    });

    test("the configured native currency is one Zodia lists", async () => {
      const currencies = await fixture.client.currencies();
      expect(currencies.map(c => c.currencyId)).toContain(fixture.provider.native.currencyId);
    });

    test("a destination outside the company's wallets and whitelist is refused before any request is raised", async () => {
      const wallet = await fixture.provider.createWalletForCustodyId(fixture.first.walletId);
      const stranger = Wallet.createRandom().address;
      await expect(wallet.signer.sendTransaction({ to: stranger, value: 1n })).rejects.toThrow(/neither a wallet of this company nor an active outgoing beneficiary/);
    });

    test("raw signing is refused: Zodia signs only approved service requests", async () => {
      const wallet = await fixture.provider.createWalletForCustodyId(fixture.first.walletId);
      await expect(wallet.signer.signMessage("hello")).rejects.toThrow(/not supported/);
    });
  });
}
