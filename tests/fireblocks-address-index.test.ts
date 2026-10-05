import { createVaultManagementFunctions, rateLimitDelayMs } from "../src/vaults";

/** A Fireblocks SDK stand-in: `vaults` vault ids, each holding ETH_TEST5 and two tokens at one address. */
function fakeSdk(vaultCount: number) {
  const calls = { listings: [] as unknown[], depositAddresses: [] as string[], assetDetails: 0 };
  const vaults = Array.from({ length: vaultCount }, (_, i) => ({ id: String(i + 1), assets: [{ id: "ETH_TEST5" }, { id: "USDC_T" }, { id: "TOKEN_T" }] }));
  const sdk = {
    getVaultAccountsWithPageInfo: async (filter: { after?: string; assetId?: string }) => {
      calls.listings.push(filter);
      return { accounts: vaults, paging: {} };
    },
    getDepositAddresses: async (vaultId: string, assetId: string) => {
      calls.depositAddresses.push(`${vaultId}:${assetId}`);
      return [{ address: `0x${vaultId.padStart(40, "0")}` }];
    },
    getAssetById: async () => { calls.assetDetails++; return { onchain: { address: "0xtoken" } }; },
  };
  return { sdk: sdk as any, vaults, calls };
}

describe("Fireblocks address lookup", () => {

  test("indexes one base-asset address per vault, listing only vaults that hold the base asset", async () => {
    const { sdk, calls } = fakeSdk(50);
    const vm = createVaultManagementFunctions(sdk, "ETH_TEST5");
    expect(await vm.getVaultIdForAddress(`0x${"37".padStart(40, "0")}`)).toBe("37");
    expect(calls.listings).toEqual([expect.objectContaining({ assetId: "ETH_TEST5" })]);
    expect(calls.depositAddresses).toHaveLength(50);
    expect(calls.depositAddresses.every(c => c.endsWith(":ETH_TEST5"))).toBe(true);
    expect(calls.assetDetails).toBe(0);
  });

  test("a warm index answers without calling Fireblocks again, whatever the address case", async () => {
    const { sdk, calls } = fakeSdk(3);
    const vm = createVaultManagementFunctions(sdk, "ETH_TEST5");
    await vm.warmAddressIndex();
    const before = calls.depositAddresses.length;
    expect(await vm.getVaultIdForAddress(`0x${"2".padStart(40, "0")}`.toUpperCase().replace("0X", "0x"))).toBe("2");
    expect(calls.depositAddresses).toHaveLength(before);
  });

  test("concurrent first lookups share one index build", async () => {
    const { sdk, calls } = fakeSdk(10);
    const vm = createVaultManagementFunctions(sdk, "ETH_TEST5");
    await Promise.all([vm.warmAddressIndex(), vm.getVaultIdForAddress(`0x${"1".padStart(40, "0")}`), vm.getVaultIdForAddress(`0x${"9".padStart(40, "0")}`)]);
    expect(calls.listings).toHaveLength(1);
    expect(calls.depositAddresses).toHaveLength(10);
  });

  test("an address not yet indexed triggers a reindex, which finds a vault created since", async () => {
    const { sdk, vaults } = fakeSdk(2);
    const vm = createVaultManagementFunctions(sdk, "ETH_TEST5");
    await vm.warmAddressIndex();
    vaults.push({ id: "3", assets: [{ id: "ETH_TEST5" }, { id: "USDC_T" }, { id: "TOKEN_T" }] });
    expect(await vm.getVaultIdForAddress(`0x${"3".padStart(40, "0")}`)).toBe("3");
    expect(await vm.getVaultIdForAddress("0x" + "ff".repeat(20))).toBeUndefined();
  });
});

describe("Fireblocks rate-limit backoff", () => {
  test("Retry-After is seconds; without it the wait doubles from one second, capped at sixteen", () => {
    expect(rateLimitDelayMs("2", 0)).toBe(2000);
    expect(rateLimitDelayMs(undefined, 0)).toBe(1000);
    expect(rateLimitDelayMs("not-a-number", 3)).toBe(8000);
    expect(rateLimitDelayMs(undefined, 10)).toBe(16000);
  });
});
