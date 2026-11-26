import { Wallet, getAddress } from "ethers";
import { CustodyProvider, custodyRegistry } from "../src/services/custody";
import { LocalCustodyProvider, createLocalCustodyConfig, registerLocal, requireDevChain } from "../src/integrations/custody/local";
import * as signerPool from "../src/integrations/signer-pool";
import { pooledSigner } from "../src/integrations/signer-pool";
import { custodyProviderConformance } from "./utils/custody-provider-conformance";

const RPC_URL = "http://localhost:1";
const KEY_A = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEY_B = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ADDRESS_A = new Wallet(KEY_A).address;
const ADDRESS_B = new Wallet(KEY_B).address;
const UNKNOWN = "0x000000000000000000000000000000000000dEaD";

const provider = () => new LocalCustodyProvider({ privateKeys: [KEY_A, KEY_B] }, RPC_URL);

custodyProviderConformance("local custody", async () => ({
  provider: provider(),
  knownCustodyId: ADDRESS_A,
  knownAddress: ADDRESS_B,
}));

describe("LocalCustodyProvider", () => {

  test("a custody id is the wallet address, matched in any letter case", async () => {
    const p = provider();
    for (const id of [ADDRESS_A, ADDRESS_A.toLowerCase(), "0x" + ADDRESS_A.slice(2).toUpperCase()]) {
      const wallet = await p.createWalletForCustodyId(id);
      expect(await wallet.signer.getAddress()).toBe(ADDRESS_A);
      expect(await p.resolveAddressFromCustodyId(id)).toBe(ADDRESS_A);
      expect(await (await p.resolveWallet(id))!.signer.getAddress()).toBe(ADDRESS_A);
    }
  });

  test("each key signs as its own address", async () => {
    const p = provider();
    expect(await (await p.createWalletForCustodyId(ADDRESS_B)).signer.getAddress()).toBe(ADDRESS_B);
    expect(ADDRESS_A).not.toBe(ADDRESS_B);
  });

  test("an unknown address resolves to no wallet and an unknown custody id is a clear error", async () => {
    const p = provider();
    expect(await p.resolveWallet(UNKNOWN)).toBeUndefined();
    await expect(p.createWalletForCustodyId(UNKNOWN)).rejects.toThrow(`unknown local custody account ${UNKNOWN}`);
    await expect(p.resolveAddressFromCustodyId(UNKNOWN)).rejects.toThrow(`unknown local custody account ${UNKNOWN}`);
  });

  test("signers come from the shared pool, one NonceManager per key", async () => {
    const p = provider();
    expect((await p.createWalletForCustodyId(ADDRESS_A)).signer).toBe(pooledSigner(RPC_URL, KEY_A));
    expect((await p.resolveWallet(ADDRESS_A))!.signer).toBe((await p.createWalletForCustodyId(ADDRESS_A)).signer);
  });

  test("it cannot create custody accounts, so OTA deposits refuse cleanly", () => {
    const asProvider: CustodyProvider = provider();
    expect(asProvider.createCustodyAccount).toBeUndefined();
  });
});

describe("createLocalCustodyConfig", () => {
  const env = (extra: Record<string, string>) => ({ LOCAL_CUSTODY_DEV_ONLY: "true", ...extra }) as NodeJS.ProcessEnv;

  test("refuses to start without the dev flag and says it is for local or dev chains only", () => {
    expect(() => createLocalCustodyConfig({ LOCAL_CUSTODY_PRIVATE_KEYS: KEY_A } as NodeJS.ProcessEnv))
      .toThrow(/local or dev chains only/);
    expect(() => createLocalCustodyConfig({ LOCAL_CUSTODY_DEV_ONLY: "false", LOCAL_CUSTODY_PRIVATE_KEYS: KEY_A } as NodeJS.ProcessEnv))
      .toThrow(/local or dev chains only/);
  });

  test("reads a comma-separated key list and ignores blanks", () => {
    expect(createLocalCustodyConfig(env({ LOCAL_CUSTODY_PRIVATE_KEYS: ` ${KEY_A}, ,${KEY_B},` })).privateKeys)
      .toEqual([KEY_A, KEY_B]);
  });

  test("requires at least one key", () => {
    expect(() => createLocalCustodyConfig(env({}))).toThrow(/LOCAL_CUSTODY_PRIVATE_KEYS is required/);
    expect(() => createLocalCustodyConfig(env({ LOCAL_CUSTODY_PRIVATE_KEYS: " , " }))).toThrow(/LOCAL_CUSTODY_PRIVATE_KEYS is required/);
  });

  test("a bad key is reported by position and never echoed", () => {
    expect(() => createLocalCustodyConfig(env({ LOCAL_CUSTODY_PRIVATE_KEYS: `${KEY_A},0xnot-a-key` })))
      .toThrow("LOCAL_CUSTODY_PRIVATE_KEYS entry 2 is not a valid private key");
    try {
      createLocalCustodyConfig(env({ LOCAL_CUSTODY_PRIVATE_KEYS: "0xnot-a-key" }));
    } catch (e) {
      expect(String(e)).not.toContain("0xnot-a-key");
    }
  });
});

describe("requireDevChain", () => {
  const chain = (chainId: bigint) => ({ getNetwork: async () => ({ chainId }) });

  test.each([31337n, 1337n])("accepts dev chain %s", async (chainId) => {
    await expect(requireDevChain(chain(chainId))).resolves.toBeUndefined();
  });

  test.each([1n, 11155111n, 137n, 31338n, 0n])("refuses chain %s and names it", async (chainId) => {
    await expect(requireDevChain(chain(chainId))).rejects.toThrow(`refuses to run on chain ${chainId}`);
  });

  test("a failed chain read stops the start", async () => {
    await expect(requireDevChain({ getNetwork: async () => { throw new Error("rpc down"); } })).rejects.toThrow("rpc down");
  });
});

describe("PROVIDER_TYPE=local through the registry", () => {
  const saved = { ...process.env };
  let chainId = 31337n;
  beforeAll(() => registerLocal());
  beforeEach(() => {
    jest.spyOn(signerPool, "pooledProvider").mockReturnValue({ getNetwork: async () => ({ chainId }) } as any);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...saved };
  });

  test("refuses to boot on a chain that is not a dev chain", async () => {
    process.env.NETWORK_HOST = RPC_URL;
    process.env.LOCAL_CUSTODY_PRIVATE_KEYS = KEY_A;
    process.env.LOCAL_CUSTODY_DEV_ONLY = "true";
    chainId = 1n;

    await expect(custodyRegistry.create("local", {})).rejects.toThrow("refuses to run on chain 1");
  });

  test("is registered by registerLocal and boots only with the dev flag", async () => {
    expect(custodyRegistry.has("local")).toBe(true);
    process.env.NETWORK_HOST = RPC_URL;
    process.env.LOCAL_CUSTODY_PRIVATE_KEYS = KEY_A;
    delete process.env.LOCAL_CUSTODY_DEV_ONLY;

    await expect(custodyRegistry.create("local", {})).rejects.toThrow(/local or dev chains only/);

    process.env.LOCAL_CUSTODY_DEV_ONLY = "true";
    chainId = 31337n;
    const created = await custodyRegistry.create("local", {});
    expect(await (await created.resolveWallet(getAddress(ADDRESS_A.toLowerCase())))!.signer.getAddress()).toBe(ADDRESS_A);
  });
});
