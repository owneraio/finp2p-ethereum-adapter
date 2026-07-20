import { TrexTokenStandard } from "@owneraio/finp2p-ethereum-trex-plugin";
import { CmtatTokenStandard } from "@owneraio/finp2p-ethereum-cmtat-plugin";
import { BenjiTokenStandard } from "@owneraio/finp2p-ethereum-benji-plugin";
import { AtsTokenStandard } from "@owneraio/finp2p-ethereum-hedera-plugin";
import { registerEthereumTokenStandards } from "../src/integrations/ethereum-standards";
import { tokenStandardRegistry } from "../src/services/direct/token-standards/registry";
import { supportsWhitelisting } from "../src/services/direct/token-standards/whitelisting";
import { resetSignerPool } from "../src/integrations/signer-pool";

const OPERATOR_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC = "http://localhost:1";

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
const warnings: string[] = [];
const warningLogger = { ...logger, warn: (m: string) => { warnings.push(m); } };

describe("registerEthereumTokenStandards (real plugin standards)", () => {

  const savedEnv = { ...process.env };
  afterAll(() => { process.env = savedEnv; resetSignerPool(); });

  test("without rpc: warns and registers nothing, does not throw", () => {
    delete process.env.OPERATOR_PRIVATE_KEY;
    delete process.env.TOKEN_STANDARD_ISSUER_PRIVATE_KEY;
    delete process.env.TOKEN_STANDARD_CONTROLLER_PRIVATE_KEY;
    delete process.env.TOKENY_API_URL;
    delete process.env.TOKENY_EMAIL;
    delete process.env.TOKENY_PASSWORD;

    registerEthereumTokenStandards({ logger: warningLogger, rpcUrl: undefined } as any);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("NETWORK_HOST");
    for (const name of ["TREX", "CMTAT", "BENJI", "HEDERA_ATS"]) {
      expect(tokenStandardRegistry.has(name)).toBe(false);
    }
  });

  test("without agent keys: registers all four in validate-only mode instead of skipping", () => {
    warnings.length = 0;
    registerEthereumTokenStandards({ logger: warningLogger, rpcUrl: RPC } as any);

    expect(warnings.some(w => w.includes("validate-only"))).toBe(true);
    for (const name of ["TREX", "CMTAT", "BENJI", "HEDERA_ATS"]) {
      expect(tokenStandardRegistry.has(name)).toBe(true);
    }
    // whitelist validation stays available: the capability probe still works
    expect(supportsWhitelisting(tokenStandardRegistry.resolve("TREX"))).toBe(true);
  });

  test("with operator key: registers all four, erc20-compatible, resolving to the plugin classes", () => {
    tokenStandardRegistry.reset();
    warnings.length = 0;
    process.env.OPERATOR_PRIVATE_KEY = OPERATOR_KEY;

    registerEthereumTokenStandards({ logger: warningLogger, rpcUrl: RPC } as any);
    // fully keyed — no warnings at all; absent TOKENY_* envs are silent
    // (TREX qualifier stays off without noise)
    expect(warnings).toEqual([]);

    const expected: Array<[string, any]> = [
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
    expect(() => registerEthereumTokenStandards({ logger, rpcUrl: RPC } as any)).not.toThrow();
  });

  test("the plan-approval whitelisting probe picks up the plugin capability", () => {
    // TREX, CMTAT and HEDERA_ATS implement InvestorWhitelisting since 0.28.2;
    // BENJI has no investor gating, so the capability is correctly absent
    for (const [name, capable] of [["TREX", true], ["CMTAT", true], ["HEDERA_ATS", true], ["BENJI", false]] as const) {
      expect(supportsWhitelisting(tokenStandardRegistry.resolve(name))).toBe(capable);
    }
  });
});
