import { TrexTokenStandard } from "@owneraio/finp2p-ethereum-trex-plugin";
import { CmtatTokenStandard } from "@owneraio/finp2p-ethereum-cmtat-plugin";
import { BenjiTokenStandard } from "@owneraio/finp2p-ethereum-benji-plugin";
import { AtsTokenStandard } from "@owneraio/finp2p-ethereum-hedera-plugin";
import { ERC20TokenStandard } from "@owneraio/finp2p-ethereum-erc20-plugin";
import { registerTokenStandards } from "../src/integrations/token-standards";
import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";
import { supportsWhitelisting } from "@owneraio/finp2p-ethereum-adapter-contract";
import { resetSignerPool } from "../src/integrations/signer-pool";

const AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC = "http://localhost:1";
const ALL = ["ERC20", "TREX", "CMTAT", "BENJI", "HEDERA_ATS"];

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
const warnings: string[] = [];
const warningLogger = { ...logger, warn: (m: string) => { warnings.push(m); } };

describe("registerTokenStandards (real plugin standards)", () => {

  const savedEnv = { ...process.env };
  afterAll(() => { process.env = savedEnv; resetSignerPool(); });

  test("without rpc: warns and registers nothing, does not throw", () => {
    delete process.env.ASSET_ISSUER_PRIVATE_KEY;
    delete process.env.ASSET_CONTROLLER_PRIVATE_KEY;
    delete process.env.ASSET_WHITELIST_PRIVATE_KEY;
    delete process.env.TOKENY_API_URL;
    delete process.env.TOKENY_EMAIL;
    delete process.env.TOKENY_PASSWORD;
    // keep collateral/DTCC out of this suite — they are separately env-gated
    delete process.env.COLLATERAL_REGISTRY_ADDRESS;
    delete process.env.COLLATERAL_AGENT_PRIVATE_KEY;
    delete process.env.DTCC_PLUGIN_ENABLED;

    registerTokenStandards({ logger: warningLogger, rpcUrl: undefined } as any);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("NETWORK_HOST");
    for (const name of ALL) expect(tokenStandardRegistry.has(name)).toBe(false);
  });

  test("without issuer/controller keys: registers all five with an ephemeral signer and warns", () => {
    // TODO: revert to fail-closed / undefined issuer once the plugins accept an
    // optional signer; today an ephemeral placeholder keeps registration on.
    warnings.length = 0;
    registerTokenStandards({ logger: warningLogger, rpcUrl: RPC } as any);

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("ephemeral");
    for (const name of ALL) expect(tokenStandardRegistry.has(name)).toBe(true);
  });

  test("with issuer + controller keys: registers all five, erc20-compatible, resolving to the plugin classes", () => {
    tokenStandardRegistry.reset();
    warnings.length = 0;
    process.env.ASSET_ISSUER_PRIVATE_KEY = AGENT_KEY;
    process.env.ASSET_CONTROLLER_PRIVATE_KEY = AGENT_KEY;

    registerTokenStandards({ logger: warningLogger, rpcUrl: RPC } as any);
    // fully keyed — no warnings at all; absent TOKENY_* envs are silent
    // (TREX qualifier stays off without noise)
    expect(warnings).toEqual([]);

    const expected: Array<[string, any]> = [
      ["ERC20", ERC20TokenStandard],
      ["TREX", TrexTokenStandard],
      ["CMTAT", CmtatTokenStandard],
      ["BENJI", BenjiTokenStandard],
      ["HEDERA_ATS", AtsTokenStandard],
    ];
    for (const [name, cls] of expected) {
      expect(tokenStandardRegistry.has(name)).toBe(true);
      expect(tokenStandardRegistry.resolve(name)).toBeInstanceOf(cls);
      expect(tokenStandardRegistry.isErc20Compatible(name)).toBe(true);
    }
  });

  test("re-registration is a no-op (has() guard), not a crash", () => {
    expect(() => registerTokenStandards({ logger, rpcUrl: RPC } as any)).not.toThrow();
  });

  test("the plan-approval whitelisting probe picks up the plugin capability", () => {
    // TREX, CMTAT and HEDERA_ATS implement InvestorWhitelisting since 0.28.2;
    // plain ERC20 and BENJI have no investor gating, so the capability is absent
    for (const [name, capable] of [
      ["TREX", true], ["CMTAT", true], ["HEDERA_ATS", true], ["BENJI", false], ["ERC20", false],
    ] as const) {
      expect(supportsWhitelisting(tokenStandardRegistry.resolve(name))).toBe(capable);
    }
  });
});
