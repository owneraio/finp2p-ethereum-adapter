import winston from "winston";
import { NetworkAccount, storage } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { TokenStandard } from "@owneraio/finp2p-ethereum-adapter-contract";
import { EvmNetworkAccountValidator, OnboardedAccountResolver, resolveAccountMappingMode } from "../src/services/accounts";
import { CustodyNetworkAccountService } from "../src/services/custody";
import { CustodyTokenService } from "../src/services/custody/token-service";
import { createWalletResolver } from "../src/integrations/wallet-resolver";
import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";

/**
 * ACCOUNT_MAPPING=disabled (the default): no account_mappings table, no /mapping endpoints.
 * Investors resolve from the router's onboarded accounts (network_accounts)
 * and from the account on each operation leg.
 */

const FIN_ID = "02" + "aa".repeat(32);
const OTHER_FIN_ID = "03" + "bb".repeat(32);
const WALLET = "0x" + "11".repeat(20);
const VAULT_ADDRESS = "0x" + "22".repeat(20);
const ESCROW = "0x" + "ee".repeat(20);
const VAULT_ID = "85";

const logger = winston.createLogger({ transports: [new winston.transports.Console({ silent: true })] });
const signerAt = (address: string) => ({ signer: { getAddress: async () => address } }) as any;

const custodyProvider = {
  resolveAddressFromCustodyId: jest.fn(async (id: string) => {
    if (id !== VAULT_ID) throw new Error(`no vault ${id}`);
    return VAULT_ADDRESS;
  }),
  createWalletForCustodyId: jest.fn(async (id: string) => signerAt(id === VAULT_ID ? VAULT_ADDRESS : "0x0")),
  resolveWallet: jest.fn(async (address: string) => (address.toLowerCase() === WALLET ? signerAt(WALLET) : undefined)),
} as any;

beforeEach(() => jest.clearAllMocks());

/** A network_accounts table in memory, queried the way the resolver queries Postgres. */
function onboarded(rows: { fin_id: string; account: NetworkAccount }[]) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const query = async (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
    if (sql.includes("WHERE fin_id = $1")) return { rows: rows.filter(r => r.fin_id === params[0]) };
    return { rows: rows.filter(r => (r.account as { address?: string }).address?.toLowerCase() === String(params[0]).toLowerCase()) };
  };
  return { resolver: new OnboardedAccountResolver(query, "ledger", custodyProvider), queries };
}

describe("ACCOUNT_MAPPING setting", () => {
  test("defaults to disabled; accepts enabled and disabled; rejects anything else", () => {
    expect(resolveAccountMappingMode(undefined)).toBe("disabled");
    expect(resolveAccountMappingMode("enabled")).toBe("enabled");
    expect(resolveAccountMappingMode(" Disabled ")).toBe("disabled");
    expect(() => resolveAccountMappingMode("off")).toThrow(/ACCOUNT_MAPPING/);
  });
});

describe("OnboardedAccountResolver", () => {

  test("a wallet binding resolves to its address, read from the adapter's schema", async () => {
    const { resolver, queries } = onboarded([{ fin_id: FIN_ID, account: { type: "walletAccount", address: WALLET } }]);
    expect(await resolver.resolveAccount(FIN_ID)).toBe(WALLET);
    expect(queries[0]).toEqual({ sql: expect.stringContaining("FROM ledger.network_accounts WHERE fin_id = $1"), params: [FIN_ID] });
  });

  test("a custodial binding resolves to the vault's address and keeps its custody account id", async () => {
    const { resolver } = onboarded([{ fin_id: FIN_ID, account: { type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID } }]);
    expect(await resolver.resolveFullAccount(FIN_ID)).toEqual({ ledgerAccountId: VAULT_ADDRESS, custodyAccountId: VAULT_ID });
  });

  test("bindings of one investor on several assets resolve when they agree, whatever the address case", async () => {
    const { resolver } = onboarded([
      { fin_id: FIN_ID, account: { type: "walletAccount", address: WALLET } },
      { fin_id: FIN_ID, account: { type: "caip10Account", network: "eip155:11155111", address: WALLET.toUpperCase().replace("0X", "0x") } },
    ]);
    expect((await resolver.resolveAccount(FIN_ID))?.toLowerCase()).toBe(WALLET);
  });

  test("bindings that disagree are reported, not guessed between", async () => {
    const { resolver } = onboarded([
      { fin_id: FIN_ID, account: { type: "walletAccount", address: WALLET } },
      { fin_id: FIN_ID, account: { type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID } },
    ]);
    await expect(resolver.resolveAccount(FIN_ID)).rejects.toThrow(/onboarded with 2 different accounts/);
  });

  test("an investor nobody onboarded resolves to nothing", async () => {
    const { resolver } = onboarded([{ fin_id: FIN_ID, account: { type: "none" } }]);
    expect(await resolver.resolveAccount(FIN_ID)).toBeUndefined();
    expect(await resolver.resolveAccount(OTHER_FIN_ID)).toBeUndefined();
  });

  test("an address maps back to its investor only when exactly one investor holds it", async () => {
    const { resolver } = onboarded([
      { fin_id: FIN_ID, account: { type: "walletAccount", address: WALLET } },
      { fin_id: FIN_ID, account: { type: "walletAccount", address: VAULT_ADDRESS } },
      { fin_id: OTHER_FIN_ID, account: { type: "walletAccount", address: VAULT_ADDRESS } },
    ]);
    expect(await resolver.resolveFinId(WALLET.toUpperCase().replace("0X", "0x"))).toBe(FIN_ID);
    expect(await resolver.resolveFinId(VAULT_ADDRESS)).toBeUndefined();
  });

  test("deposits' wallet resolver opens the custodial binding's vault", async () => {
    const { resolver } = onboarded([{ fin_id: FIN_ID, account: { type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID } }]);
    const resolved = await createWalletResolver(resolver, custodyProvider)(FIN_ID);
    expect(resolved?.walletAddress).toBe(VAULT_ADDRESS);
    expect(custodyProvider.createWalletForCustodyId).toHaveBeenCalledWith(VAULT_ID);
  });
});

describe("CustodyNetworkAccountService without an account mapping", () => {

  const storeMock = (): jest.Mocked<storage.NetworkAccountStore> => ({
    insert: jest.fn().mockImplementation(async (row) => row),
    getByFinId: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  });
  const build = (store: storage.NetworkAccountStore) =>
    new CustodyNetworkAccountService(store, custodyProvider, undefined, logger as any, undefined, new EvmNetworkAccountValidator({ custodial: true }), "fireblocks");

  test("a custodial bind is recorded as sent, after its vault is checked to exist", async () => {
    const store = storeMock();
    const account = { type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID } as const;
    const op = await build(store).createAccount("ik", "org", "asset", FIN_ID, { account });
    expect(op.type).toBe("success");
    expect((op as any).record.account).toEqual(account);
    expect(custodyProvider.resolveAddressFromCustodyId).toHaveBeenCalledWith(VAULT_ID);
  });

  test("the custody-id overload is recorded as the custodial account it stands for", async () => {
    const store = storeMock();
    const op = await build(store).createAccount("ik", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: VAULT_ID } });
    expect((op as any).record.account).toEqual({ type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID });
  });

  test("an EVM wallet bind is recorded as-is", async () => {
    const store = storeMock();
    const op = await build(store).createAccount("ik", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: WALLET } });
    expect((op as any).record.account).toEqual({ type: "walletAccount", address: WALLET });
  });

  test("an unknown vault is still refused before anything is stored", async () => {
    const store = storeMock();
    await expect(build(store).createAccount("ik", "org", "asset", FIN_ID, { account: { type: "custodialAccount", provider: "fireblocks", vaultAccountId: "999" } })).rejects.toThrow(/cannot resolve custody account/);
    expect(store.insert).not.toHaveBeenCalled();
  });

  test("the validator still refuses a custodial account with the mapping on", async () => {
    await expect(new EvmNetworkAccountValidator().validate({ type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID })).rejects.toThrow(/Unsupported network account type/);
  });
});

describe("CustodyTokenService resolving from operation legs", () => {

  const ok = { status: "success", transactionId: "0xtx", timestamp: 1 } as const;
  const standard = { transfer: jest.fn().mockResolvedValue(ok), release: jest.fn().mockResolvedValue(ok) } as unknown as TokenStandard & { transfer: jest.Mock; release: jest.Mock };
  beforeAll(() => tokenStandardRegistry.register("LEGS_TEST", standard));

  const ASSET = { assetId: "bank-us:102:asset-1", assetType: "finp2p" } as any;
  const assetStore = { getAsset: async () => ({ contract_address: "0x" + "cc".repeat(20), decimals: 2, token_standard: "LEGS_TEST" }) } as any;
  const nothingOnboarded = { resolveAccount: async () => undefined, resolveFullAccount: async () => undefined, resolveFinId: async () => undefined };
  const readProvider = { getNetwork: async () => ({ chainId: 11155111n }) } as any;
  const service = () => new CustodyTokenService(logger, custodyProvider, signerAt(ESCROW), readProvider, nothingOnboarded, assetStore, undefined);

  test("a source leg's wallet account signs through the custody wallet holding that address", async () => {
    const op = await service().transfer("ik", "n", { finId: FIN_ID, account: { type: "walletAccount", address: WALLET } },
      { finId: OTHER_FIN_ID, account: { type: "walletAccount", address: VAULT_ADDRESS } }, ASSET, "1.00", undefined as any, undefined);
    expect(op.type).toBe("success");
    expect(custodyProvider.resolveWallet).toHaveBeenCalledWith(WALLET);
    expect(standard.transfer.mock.calls[0]![2]).toBe(VAULT_ADDRESS);
  });

  test("a source leg's custodial account opens its vault; a custodial destination resolves to its vault's address", async () => {
    const op = await service().transfer("ik", "n", { finId: FIN_ID, account: { type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID } },
      { finId: OTHER_FIN_ID, account: { type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID } }, ASSET, "1.00", undefined as any, undefined);
    expect(op.type).toBe("success");
    expect(custodyProvider.createWalletForCustodyId).toHaveBeenCalledWith(VAULT_ID);
    expect(standard.transfer.mock.calls[standard.transfer.mock.calls.length - 1]![2]).toBe(VAULT_ADDRESS);
  });

  test("a source with neither an onboarded account nor a leg account fails as before", async () => {
    const op = await service().transfer("ik", "n", { finId: FIN_ID }, { finId: OTHER_FIN_ID, account: { type: "walletAccount", address: WALLET } }, ASSET, "1.00", undefined as any, undefined);
    expect(op.type).toBe("failure");
  });

  test("a rollback returns the hold to the source leg's address", async () => {
    const op = await service().rollback("ik", { finId: FIN_ID, account: { type: "walletAccount", address: WALLET } }, ASSET, "1.00", "op-1", undefined);
    expect(op.type).toBe("success");
    expect(standard.release.mock.calls[standard.release.mock.calls.length - 1]![2]).toBe(WALLET);
  });
});
