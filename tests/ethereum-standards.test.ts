import { TrexTokenStandard } from "@owneraio/finp2p-ethereum-trex-plugin";
import { CmtatTokenStandard } from "@owneraio/finp2p-ethereum-cmtat-plugin";
import { BenjiTokenStandard } from "@owneraio/finp2p-ethereum-benji-plugin";
import { AtsTokenStandard } from "@owneraio/finp2p-ethereum-hedera-plugin";
import { registerEthereumTokenStandards } from "../src/integrations/ethereum-standards";
import { tokenStandardRegistry } from "../src/services/direct/token-standards/registry";
import { resetSignerPool } from "../src/integrations/signer-pool";

const OPERATOR_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC = "http://localhost:1";

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
const warnings: string[] = [];
const warningLogger = { ...logger, warn: (m: string) => { warnings.push(m); } };

describe("registerEthereumTokenStandards (real plugin standards)", () => {

  const savedEnv = { ...process.env };
  afterAll(() => { process.env = savedEnv; resetSignerPool(); });

  test("without rpc/key: warns and registers nothing, does not throw", () => {
    delete process.env.OPERATOR_PRIVATE_KEY;
    delete process.env.TOKEN_STANDARD_ISSUER_PRIVATE_KEY;
    delete process.env.TOKEN_STANDARD_CONTROLLER_PRIVATE_KEY;

    registerEthereumTokenStandards({ logger: warningLogger, rpcUrl: undefined } as any);
    expect(warnings.length).toBe(1);
    for (const name of ["TREX", "CMTAT", "BENJI", "HEDERA_ATS"]) {
      expect(tokenStandardRegistry.has(name)).toBe(false);
    }
  });

  test("with operator key: registers all four, erc20-compatible, resolving to the plugin classes", () => {
    process.env.OPERATOR_PRIVATE_KEY = OPERATOR_KEY;

    registerEthereumTokenStandards({ logger, rpcUrl: RPC } as any);

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
});
