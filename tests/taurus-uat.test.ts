import { JsonRpcProvider, Wallet, parseUnits } from "ethers";
import { ERC20TokenStandard, ERC20__factory } from "@owneraio/finp2p-ethereum-erc20-plugin";
import { AssetRecord, Logger, TokenWallet } from "@owneraio/finp2p-ethereum-adapter-contract";
import { TaurusCustodyProvider } from "../src/integrations/custody/taurus";
import { TaurusAppConfig } from "../src/integrations/custody/taurus/config";

/**
 * Live token-lifecycle suite against a real Taurus-PROTECT org, exercising
 * BOTH operation modes through the actual token standard + custody signers:
 * mint outside custody (issuer EOA), internal transfer, transfer to an
 * external whitelisted address, and an investor-initiated burn.
 *
 * Runs only when the TAURUS_* connection env and the issuer key are set:
 *
 *   TAURUS_HOST / TAURUS_API_KEY / TAURUS_API_SECRET
 *   TAURUS_TEST_ISSUER_PRIVATE_KEY  issuer EOA (token operator, pays own gas)
 *   TAURUS_TEST_TOKEN               onboarded ERC20; unset => the bootstrap
 *                                   test deploys+mints a fresh one and prints
 *                                   the org-onboarding checklist
 *   TAURUS_TEST_INVESTOR_A/B        internal Taurus custody addresses
 *   TAURUS_TEST_EXTERNAL            whitelisted external payout address
 *
 * Org prerequisites (once per token/org, via console):
 *   transfer-only:  token whitelisted+approved (=> currency), USD price,
 *                   transfer-rule line; TAURUS_TEST_EXTERNAL approved in the
 *                   whitelisted-addresses registry
 *   contract-call:  token contract approved in the whitelisted-ADDRESSES
 *                   registry + contract-interaction governance rules
 *
 *   npm run test:taurus     (NODE_EXTRA_CA_CERTS may be needed behind TLS
 *                            inspection, e.g. /etc/ssl/certs/ca-certificates.crt)
 */

const LIVE = !!(process.env.TAURUS_HOST && process.env.TAURUS_API_KEY && process.env.TAURUS_API_SECRET
  && process.env.TAURUS_TEST_ISSUER_PRIVATE_KEY);

const RPC_URL = process.env.NETWORK_HOST ?? "https://ethereum-sepolia-rpc.publicnode.com";
const TOKEN = process.env.TAURUS_TEST_TOKEN;
const INVESTOR_A = process.env.TAURUS_TEST_INVESTOR_A ?? "0x5a814de4cec9414f28ff2a837c043f2405c07363";
const INVESTOR_B = process.env.TAURUS_TEST_INVESTOR_B ?? "0xcd971e054569fd0c430b92b2e8098ace3638ee58";
const EXTERNAL = process.env.TAURUS_TEST_EXTERNAL;

const logger = console as unknown as Logger;

function taurusConfig(operationMode: TaurusAppConfig["operationMode"]): TaurusAppConfig {
  return {
    host: process.env.TAURUS_HOST!,
    apiKey: process.env.TAURUS_API_KEY!,
    apiSecret: process.env.TAURUS_API_SECRET!,
    authScheme: "TPV1",
    operationMode,
    rpcUrl: RPC_URL,
    operatorPrivateKey: process.env.TAURUS_OPERATOR_PRIVATE_KEY,
    requestPollIntervalMs: 5000,
    requestTimeoutMs: 600000,
  };
}

(LIVE ? describe : describe.skip)("Taurus UAT token lifecycle", () => {

  let rpc: JsonRpcProvider;
  let issuer: Wallet;
  let standard: ERC20TokenStandard;
  let issuerWallet: TokenWallet;

  beforeAll(() => {
    rpc = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
    issuer = new Wallet(process.env.TAURUS_TEST_ISSUER_PRIVATE_KEY!, rpc);
    standard = new ERC20TokenStandard(rpc, issuer);
    issuerWallet = { provider: rpc, signer: issuer };
  });

  const erc20 = (token: string) => ERC20__factory.connect(token, rpc);
  const balance = async (token: string, addr: string) => erc20(token).balanceOf(addr);

  (TOKEN ? test.skip : test)("bootstrap: deploy a fresh default-standard ERC20 and mint outside custody", async () => {
    const deployed = await standard.deploy(issuerWallet, "Taurus Lifecycle Test", "TLT", 2, logger);
    const minted = await standard.mint(issuerWallet, {
      contractAddress: deployed.contractAddress, decimals: 2, tokenStandard: deployed.tokenStandard,
    }, INVESTOR_A, parseUnits("100", 2), logger);
    expect(minted.status).toBe("success");
    console.log(`
      Token deployed: ${deployed.contractAddress} (issuer/operator ${issuer.address})
      Onboard it on the Taurus org, then set TAURUS_TEST_TOKEN=${deployed.contractAddress} and re-run:
        1. whitelist+approve the contract (=> currency; set decimals=2)
        2. add a USD price for it
        3. add its transfer-rule line (Governance rules -> Transactions)
        4. contract-call mode: approve the contract in the whitelisted-ADDRESSES
           registry and add contract-interaction rules
    `);
  });

  (TOKEN ? describe : describe.skip)("with the onboarded token", () => {

    let asset: AssetRecord;

    beforeAll(async () => {
      const decimals = await erc20(TOKEN!).decimals();
      asset = { contractAddress: TOKEN!, decimals: Number(decimals), tokenStandard: "erc20" };
    });

    test("mint outside custody: issuer EOA mints to investor A", async () => {
      const before = await balance(TOKEN!, INVESTOR_A);
      const result = await standard.mint(issuerWallet, asset, INVESTOR_A, parseUnits("10", asset.decimals), logger);
      expect(result.status).toBe("success");
      expect(await balance(TOKEN!, INVESTOR_A)).toBe(before + parseUnits("10", asset.decimals));
    });

    describe("transfer-only mode", () => {

      let provider: TaurusCustodyProvider;
      beforeAll(async () => {
        provider = await TaurusCustodyProvider.create(taurusConfig("transfer-only"));
      });

      test("internal transfer: A -> B through the custody signer", async () => {
        const wallet = await provider.resolveWallet(INVESTOR_A);
        expect(wallet).toBeDefined();
        const before = await balance(TOKEN!, INVESTOR_B);
        const result = await standard.transfer(wallet!, asset, INVESTOR_B, parseUnits("3", asset.decimals), logger);
        expect(result).toMatchObject({ status: "success" });
        expect(await balance(TOKEN!, INVESTOR_B)).toBe(before + parseUnits("3", asset.decimals));
      });

      test("external transfer: A -> whitelisted external address", async () => {
        if (!EXTERNAL) return console.warn("TAURUS_TEST_EXTERNAL not set — skipping");
        const wallet = await provider.resolveWallet(INVESTOR_A);
        const before = await balance(TOKEN!, EXTERNAL);
        const result = await standard.transfer(wallet!, asset, EXTERNAL, parseUnits("2", asset.decimals), logger);
        expect(result).toMatchObject({ status: "success" });
        expect(await balance(TOKEN!, EXTERNAL)).toBe(before + parseUnits("2", asset.decimals));
      });

      test("investor burn is refused (token standards unsupported in this mode)", async () => {
        const wallet = await provider.resolveWallet(INVESTOR_A);
        const result = await standard.burn(wallet!, asset, INVESTOR_A, parseUnits("1", asset.decimals), logger);
        expect(result.status).toBe("failure");
        expect((result as { reason: string }).reason).toMatch(/not supported in transfer-only mode/);
      });
    });

    describe("contract-call mode", () => {

      let provider: TaurusCustodyProvider;
      beforeAll(async () => {
        provider = await TaurusCustodyProvider.create(taurusConfig("contract-call"));
      });

      test("internal transfer: A -> B as a structured contract call", async () => {
        const wallet = await provider.resolveWallet(INVESTOR_A);
        expect(wallet).toBeDefined();
        const before = await balance(TOKEN!, INVESTOR_B);
        const result = await standard.transfer(wallet!, asset, INVESTOR_B, parseUnits("3", asset.decimals), logger);
        expect(result).toMatchObject({ status: "success" });
        expect(await balance(TOKEN!, INVESTOR_B)).toBe(before + parseUnits("3", asset.decimals));
      });

      test("external transfer: A -> external address as a structured contract call", async () => {
        if (!EXTERNAL) return console.warn("TAURUS_TEST_EXTERNAL not set — skipping");
        const wallet = await provider.resolveWallet(INVESTOR_A);
        const before = await balance(TOKEN!, EXTERNAL);
        const result = await standard.transfer(wallet!, asset, EXTERNAL, parseUnits("2", asset.decimals), logger);
        expect(result).toMatchObject({ status: "success" });
        expect(await balance(TOKEN!, EXTERNAL)).toBe(before + parseUnits("2", asset.decimals));
      });

      test("investor-initiated burn: self-burn from A reduces supply", async () => {
        const wallet = await provider.resolveWallet(INVESTOR_A);
        const supplyBefore = await erc20(TOKEN!).totalSupply();
        const result = await standard.burn(wallet!, asset, INVESTOR_A, parseUnits("1", asset.decimals), logger);
        expect(result).toMatchObject({ status: "success" });
        expect(await erc20(TOKEN!).totalSupply()).toBe(supplyBefore - parseUnits("1", asset.decimals));
      });
    });
  });
});
