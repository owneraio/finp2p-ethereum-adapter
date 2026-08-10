import { AccountInvalidShapeError, storage } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { WhitelistParty } from "@owneraio/finp2p-ethereum-adapter-contract";
import { ChainInvestorWhitelistService, EvmNetworkAccountValidator, MappingWhitelisting, WhitelistingMappingValidator, withDewhitelistOnDelete } from "../src/services/accounts";
import { finIdToAddress } from "@owneraio/finp2p-ethereum-orchestrator";
import { OnChainTokenService, OnChainNetworkAccountService } from "../src/services/onchain";
import { CustodyNetworkAccountService } from "../src/services/custody";
import { ValidationError, WhitelistRefusedError } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";

const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("EvmNetworkAccountValidator", () => {

  const validator = new EvmNetworkAccountValidator();

  test("accepts a wallet with a valid EVM address", async () => {
    await expect(validator.validate({ type: "walletAccount", address: ADDRESS })).resolves.toBeUndefined();
  });

  test("rejects non-wallet account types", async () => {
    await expect(validator.validate({ type: "none" })).rejects.toThrow(AccountInvalidShapeError);
  });

  test("rejects malformed addresses", async () => {
    await expect(validator.validate({ type: "walletAccount", address: "not-an-address" } as any)).rejects.toThrow(AccountInvalidShapeError);
    await expect(validator.validate({ type: "walletAccount", address: "0x1234" } as any)).rejects.toThrow(AccountInvalidShapeError);
  });
});

describe("OnChainTokenService credential resolution", () => {

  const FIN_ID = "02b3e7cbe9b2e91832ea4a11a17a2e30d3cf52dae486ec1e1e3d0741e1f77210ab";

  const contractMock = (registered: boolean) => ({
    getCredentialAddress: registered
      ? jest.fn().mockResolvedValue(ADDRESS)
      : jest.fn().mockRejectedValue(new Error("credential not found")),
    addCredential: jest.fn().mockResolvedValue({ hash: "0x0" }),
  });

  const ensure = (service: OnChainTokenService, finId: string) =>
    (service as any).ensureCredential(finId);

  test("known credential resolves and is cached", async () => {
    const contract = contractMock(true);
    const service = new OnChainTokenService(contract as any, undefined, undefined, undefined, undefined);
    await ensure(service, FIN_ID);
    await ensure(service, FIN_ID);
    expect(contract.getCredentialAddress).toHaveBeenCalledTimes(1);
    expect(contract.addCredential).not.toHaveBeenCalled();
  });

  test("unknown credential rethrows — never registers during checking", async () => {
    const contract = contractMock(false);
    const service = new OnChainTokenService(contract as any, undefined, undefined, undefined, undefined);
    await expect(ensure(service, FIN_ID)).rejects.toThrow("credential not found");
    expect(contract.addCredential).not.toHaveBeenCalled();
  });
});

describe("OnChainNetworkAccountService onboarding", () => {

  const storeMock = (): jest.Mocked<storage.NetworkAccountStore> => ({
    insert: jest.fn().mockImplementation(async (row) => row),
    getByFinId: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  });

  const contractMock = () => ({
    addCredential: jest.fn().mockResolvedValue({ hash: "0x0" }),
  });

  const FIN_ID = "02b3e7cbe9b2e91832ea4a11a17a2e30d3cf52dae486ec1e1e3d0741e1f77210ab";

  test("create-new: derives the wallet from the finId, registers and persists it", async () => {
    const store = storeMock();
    const contract = contractMock();
    const service = new OnChainNetworkAccountService(store, contract as any, new EvmNetworkAccountValidator());

    const op = await service.createAccount("ik-1", "org", "asset", FIN_ID, undefined);
    expect(op.type).toBe("success");
    const record = (op as any).record;
    expect(record.account).toEqual({ type: "walletAccount", address: finIdToAddress(FIN_ID) });
    expect(contract.addCredential).toHaveBeenCalledWith(FIN_ID, record.account.address);
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ finId: FIN_ID, account: record.account }));
  });

  test("bind-existing: registers the supplied wallet under the investor finId", async () => {
    const store = storeMock();
    const contract = contractMock();
    const service = new OnChainNetworkAccountService(store, contract as any, new EvmNetworkAccountValidator());

    const op = await service.createAccount("ik-2", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: ADDRESS } });
    expect(op.type).toBe("success");
    expect((op as any).record.account).toEqual({ type: "walletAccount", address: ADDRESS });
    expect(contract.addCredential).toHaveBeenCalledWith(FIN_ID, ADDRESS);
    expect(store.insert).toHaveBeenCalledTimes(1);
  });

  test("bind-existing with invalid wallet: rejected before any chain call", async () => {
    const store = storeMock();
    const contract = contractMock();
    const service = new OnChainNetworkAccountService(store, contract as any, new EvmNetworkAccountValidator());

    await expect(service.createAccount("ik-2b", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: "0x1234" } as any }))
      .rejects.toThrow(AccountInvalidShapeError);
    expect(contract.addCredential).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();
  });
});

describe("CustodyNetworkAccountService onboarding whitelisting", () => {

  const FIN_ID = "02b3e7cbe9b2e91832ea4a11a17a2e30d3cf52dae486ec1e1e3d0741e1f77210ab";
  const WL_ASSET = "org:102:wl-asset";
  const PLAIN_ASSET = "org:102:plain-asset";
  const UNKNOWN_ASSET = "org:102:unknown-asset";

  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

  type Mutation = { op: string; contractAddress: string; party: WhitelistParty };
  const mutations: Mutation[] = [];
  let whitelistFails = false;

  beforeAll(() => {
    tokenStandardRegistry.reset();
    const record = (op: string) => async (asset: any, party: WhitelistParty) => {
      mutations.push({ op, contractAddress: asset.contractAddress, party });
      return whitelistFails
        ? { status: "failure", reason: "compliance says no" }
        : { status: "success", transactionId: "tx", timestamp: 0 };
    };
    tokenStandardRegistry.register("WL", {
      isWhitelisted: async () => true,
      whitelist: record("whitelist"),
      dewhitelist: record("dewhitelist"),
    } as any);
    tokenStandardRegistry.register("PLAIN", {} as any);
  });
  afterAll(() => tokenStandardRegistry.reset());
  beforeEach(() => { mutations.length = 0; whitelistFails = false; });

  const assetStore = {
    getAsset: async (id: string) => {
      if (id === WL_ASSET) return { contract_address: "0xwl", decimals: 2, token_standard: "WL", id };
      if (id === PLAIN_ASSET) return { contract_address: "0xplain", decimals: 2, token_standard: "PLAIN", id };
      return undefined;
    },
  } as any;

  const storeMock = (existing?: storage.NetworkAccountRow): jest.Mocked<storage.NetworkAccountStore> => ({
    insert: jest.fn().mockImplementation(async (row) => row),
    getByFinId: jest.fn().mockResolvedValue(existing),
    remove: jest.fn().mockResolvedValue(existing),
  });

  const VAULT_ID = "85";
  const custodyProvider = {
    resolveAddressFromCustodyId: jest.fn().mockImplementation(async (id: string) => {
      if (id !== VAULT_ID) throw new Error(`No deposit address found for vault ${id}`);
      return ADDRESS;
    }),
  } as any;
  const mappingService = {
    saveAccount: jest.fn().mockResolvedValue(undefined),
    getByFieldValue: jest.fn().mockResolvedValue([]),
  } as any;
  beforeEach(() => {
    custodyProvider.resolveAddressFromCustodyId.mockClear();
    mappingService.saveAccount.mockClear();
    mappingService.getByFieldValue.mockClear().mockResolvedValue([]);
  });

  const build = (store: storage.NetworkAccountStore, dewhitelistOnRemove = true, enabled = true) =>
    new CustodyNetworkAccountService(store, assetStore, custodyProvider, mappingService, logger, { enabled, dewhitelistOnRemove }, new EvmNetworkAccountValidator());

  const bind = { account: { type: "walletAccount", address: ADDRESS } as const };
  const row: storage.NetworkAccountRow = {
    accountId: "acc-1", idempotencyKey: undefined, organizationId: "org",
    assetId: WL_ASSET, finId: FIN_ID, account: bind.account,
  };

  test("create whitelists the bound wallet on the asset's standard and mirrors the mapping", async () => {
    const store = storeMock();
    const op = await build(store).createAccount("ik", "org", WL_ASSET, FIN_ID, bind);
    expect(op.type).toBe("success");
    expect(store.insert).toHaveBeenCalledTimes(1);
    expect(mappingService.saveAccount).toHaveBeenCalledWith(FIN_ID, { ledgerAccountId: ADDRESS });
    expect(mutations).toEqual([{
      op: "whitelist", contractAddress: "0xwl",
      party: { finId: FIN_ID, address: ADDRESS, role: "destination" },
    }]);
  });

  test("custodialAccount bind: vault id resolved, mirrored with both fields, whitelisted", async () => {
    const store = storeMock();
    const op = await build(store).createAccount("ik", "org", WL_ASSET, FIN_ID,
      { account: { type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID } });
    expect(op.type).toBe("success");
    expect((op as any).record.account).toEqual({ type: "walletAccount", address: ADDRESS });
    expect(custodyProvider.resolveAddressFromCustodyId).toHaveBeenCalledWith(VAULT_ID);
    expect(mappingService.saveAccount).toHaveBeenCalledWith(FIN_ID, { ledgerAccountId: ADDRESS, custodyAccountId: VAULT_ID });
    expect(mutations.map(m => m.party.address)).toEqual([ADDRESS]);
  });

  test("non-EVM address binds as a custody account id: resolved, mirrored with both fields, whitelisted", async () => {
    const store = storeMock();
    const op = await build(store).createAccount("ik", "org", WL_ASSET, FIN_ID, { account: { type: "walletAccount", address: VAULT_ID } });
    expect(op.type).toBe("success");
    expect((op as any).record.account).toEqual({ type: "walletAccount", address: ADDRESS });
    expect(custodyProvider.resolveAddressFromCustodyId).toHaveBeenCalledWith(VAULT_ID);
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ account: { type: "walletAccount", address: ADDRESS } }));
    expect(mappingService.saveAccount).toHaveBeenCalledWith(FIN_ID, { ledgerAccountId: ADDRESS, custodyAccountId: VAULT_ID });
    expect(mutations.map(m => m.party.address)).toEqual([ADDRESS]);
  });

  test("unresolvable custody account id is rejected before any persistence", async () => {
    const store = storeMock();
    await expect(build(store).createAccount("ik", "org", WL_ASSET, FIN_ID, { account: { type: "walletAccount", address: "no-such-vault" } }))
      .rejects.toThrow(AccountInvalidShapeError);
    expect(store.insert).not.toHaveBeenCalled();
    expect(mappingService.saveAccount).not.toHaveBeenCalled();
    expect(mutations).toHaveLength(0);
  });

  test("custody-id bind without a resolving provider is rejected", async () => {
    const store = storeMock();
    const service = new CustodyNetworkAccountService(store, assetStore, undefined, mappingService, logger, { enabled: true, dewhitelistOnRemove: true }, new EvmNetworkAccountValidator());
    await expect(service.createAccount("ik", "org", WL_ASSET, FIN_ID, { account: { type: "walletAccount", address: VAULT_ID } }))
      .rejects.toThrow(AccountInvalidShapeError);
    expect(store.insert).not.toHaveBeenCalled();
  });

  test("replayed create re-asserts the whitelist (idempotent self-heal)", async () => {
    // skeleton 0.28.25: insert() is atomic and returns the pre-existing binding on replay
    const store = storeMock(row);
    store.insert.mockResolvedValue(row);
    const op = await build(store).createAccount("ik", "org", WL_ASSET, FIN_ID, bind);
    expect(op.type).toBe("success");
    expect((op as any).record.id).toBe("acc-1");
    expect(mutations.map(m => m.op)).toEqual(["whitelist"]);
  });

  test("standard without the whitelisting capability binds without mutations", async () => {
    const op = await build(storeMock()).createAccount("ik", "org", PLAIN_ASSET, FIN_ID, bind);
    expect(op.type).toBe("success");
    expect(mutations).toHaveLength(0);
  });

  test("asset not kept in this adapter binds without mutations", async () => {
    const op = await build(storeMock()).createAccount("ik", "org", UNKNOWN_ASSET, FIN_ID, bind);
    expect(op.type).toBe("success");
    expect(mutations).toHaveLength(0);
  });

  test("whitelist failure fails the onboarding before anything persists", async () => {
    // the workflow proxy dedups by (method, inputs): a failure is terminal for
    // that idempotency key, so it must leave no half-applied state behind
    whitelistFails = true;
    const store = storeMock();
    const op = await build(store).createAccount("ik", "org", WL_ASSET, FIN_ID, bind);
    expect(op.type).toBe("failure");
    expect((op as any).error.message).toMatch(/compliance says no/);
    expect(store.insert).not.toHaveBeenCalled();
    expect(mappingService.saveAccount).not.toHaveBeenCalled();
  });

  test("remove keeps the binding durable while dewhitelisting, then deletes it", async () => {
    const store = storeMock(row);
    const op = await build(store).removeAccount("ik", "acc-1");
    expect(op.type).toBe("success");
    expect(store.insert).toHaveBeenCalledWith(row); // restored before the chain mutation
    expect(store.remove).toHaveBeenCalledTimes(2); // peek + final delete after success
    expect(mappingService.saveAccount).not.toHaveBeenCalled();
    expect(mutations).toEqual([{
      op: "dewhitelist", contractAddress: "0xwl",
      party: { finId: FIN_ID, address: ADDRESS, role: "destination" },
    }]);
  });

  test("dewhitelist failure leaves the binding in place and fails the removal", async () => {
    whitelistFails = true;
    const store = storeMock(row);
    const op = await build(store).removeAccount("ik", "acc-1");
    expect(op.type).toBe("failure");
    expect(store.insert).toHaveBeenCalledWith(row);
    expect(store.remove).toHaveBeenCalledTimes(1); // never deleted after the failure
  });

  test("a wallet shared with another investor is unbound but never dewhitelisted", async () => {
    const store = storeMock(row);
    mappingService.getByFieldValue.mockResolvedValue([
      { finId: FIN_ID, fields: { ledgerAccountId: ADDRESS } },
      { finId: "03" + "cc".repeat(32), fields: { ledgerAccountId: ADDRESS } },
    ]);
    const op = await build(store).removeAccount("ik", "acc-1");
    expect(op.type).toBe("success");
    expect(store.remove).toHaveBeenCalledTimes(2);
    expect(mutations).toHaveLength(0);
  });

  test("omnibus (dewhitelistOnRemove=false): shared wallet is never dewhitelisted", async () => {
    const store = storeMock(row);
    const op = await build(store, false).removeAccount("ik", "acc-1");
    expect(op.type).toBe("success");
    expect(mutations).toHaveLength(0);
  });

  test("flag off: binds and mirrors but never mutates the token standard", async () => {
    const store = storeMock();
    const service = build(store, true, false);
    const op = await service.createAccount("ik", "org", WL_ASSET, FIN_ID, bind);
    expect(op.type).toBe("success");
    expect(mappingService.saveAccount).toHaveBeenCalledWith(FIN_ID, { ledgerAccountId: ADDRESS });
    expect(mutations).toHaveLength(0);
  });

  test("flag off: remove never dewhitelists", async () => {
    const store = storeMock(row);
    const op = await build(store, true, false).removeAccount("ik", "acc-1");
    expect(op.type).toBe("success");
    expect(mutations).toHaveLength(0);
  });

  test("removing an absent binding stays an idempotent success", async () => {
    const op = await build(storeMock()).removeAccount("ik", "acc-x");
    expect(op.type).toBe("success");
    expect(mutations).toHaveLength(0);
  });
});

describe("MappingWhitelisting (internal mapping API)", () => {

  const FIN_ID = "02b3e7cbe9b2e91832ea4a11a17a2e30d3cf52dae486ec1e1e3d0741e1f77210ab";
  const OTHER_FIN_ID = "03" + "dd".repeat(32);
  const OLD_ADDRESS = "0x5555555555555555555555555555555555555555";
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

  const mutations: Array<{ op: string; contractAddress: string; address: string }> = [];
  const alreadyWhitelisted = new Set<string>(); // `${contract}:${address(lc)}`
  let failOnContract: string | undefined;
  let failDewhitelistOnContract: string | undefined;

  beforeAll(() => {
    tokenStandardRegistry.reset();
    tokenStandardRegistry.register("WL", {
      isWhitelisted: async (asset: any, p: any) => alreadyWhitelisted.has(`${asset.contractAddress}:${p.address.toLowerCase()}`),
      whitelist: async (asset: any, p: any) => {
        mutations.push({ op: "whitelist", contractAddress: asset.contractAddress, address: p.address });
        return asset.contractAddress === failOnContract
          ? { status: "failure", reason: "compliance says no" }
          : { status: "success", transactionId: "tx", timestamp: 0 };
      },
      dewhitelist: async (asset: any, p: any) => {
        mutations.push({ op: "dewhitelist", contractAddress: asset.contractAddress, address: p.address });
        return asset.contractAddress === failDewhitelistOnContract
          ? { status: "failure", reason: "cannot revoke" }
          : { status: "success", transactionId: "tx", timestamp: 0 };
      },
    } as any);
    tokenStandardRegistry.register("PLAIN", {} as any);
  });
  afterAll(() => tokenStandardRegistry.reset());

  const mappingServiceMock = {
    getAccounts: jest.fn(),
    getByFieldValue: jest.fn(),
    deleteAccount: jest.fn(),
  } as any;
  beforeEach(() => {
    mutations.length = 0; failOnContract = undefined; failDewhitelistOnContract = undefined; alreadyWhitelisted.clear();
    mappingServiceMock.getAccounts.mockReset().mockResolvedValue([]);
    mappingServiceMock.getByFieldValue.mockReset().mockResolvedValue([]);
    mappingServiceMock.deleteAccount.mockReset().mockResolvedValue(undefined);
  });

  const assets = [
    { id: "org:102:a1", contract_address: "0xa1", decimals: 2, token_standard: "WL" },
    { id: "org:102:a2", contract_address: "0xa2", decimals: 2, token_standard: "PLAIN" },
    { id: "org:102:a3", contract_address: "0xa3", decimals: 2, token_standard: "NOT_REGISTERED" },
    { id: "org:102:a4", contract_address: "0xa4", decimals: 2, token_standard: "WL" },
  ] as any[];
  const listAssets = async () => assets;

  const service = () => new MappingWhitelisting(listAssets, () => mappingServiceMock, logger);
  const validator = (inner?: any) => new WhitelistingMappingValidator(inner, service());

  test("whitelists the mapped wallet on every capable asset, skipping the rest", async () => {
    const fields = { ledgerAccountId: ADDRESS };
    const validated = await validator().validate(FIN_ID, fields);
    expect(validated).toEqual(fields);
    expect(mutations).toEqual([
      { op: "whitelist", contractAddress: "0xa1", address: ADDRESS },
      { op: "whitelist", contractAddress: "0xa4", address: ADDRESS },
    ]);
  });

  test("runs after the inner validator so an enriched address is whitelisted", async () => {
    const inner = { validate: jest.fn().mockResolvedValue({ custodyAccountId: "85", ledgerAccountId: ADDRESS }) };
    const validated = await validator(inner).validate(FIN_ID, { custodyAccountId: "85" });
    expect(inner.validate).toHaveBeenCalledWith(FIN_ID, { custodyAccountId: "85" });
    expect(validated.ledgerAccountId).toBe(ADDRESS);
    expect(mutations.map(m => m.address)).toEqual([ADDRESS, ADDRESS]);
  });

  test("mid-sequence failure compensates only this request's transitions — pre-existing authorization survives", async () => {
    alreadyWhitelisted.add(`0xa1:${ADDRESS.toLowerCase()}`); // authorized before the request
    failOnContract = "0xa4";
    await expect(validator().validate(FIN_ID, { ledgerAccountId: ADDRESS }))
      .rejects.toThrow(/whitelisting investor .* for asset org:102:a4 failed: compliance says no/);
    // a1 was skipped (already whitelisted) and is NOT dewhitelisted on rollback
    expect(mutations).toEqual([
      { op: "whitelist", contractAddress: "0xa4", address: ADDRESS },
    ]);
  });

  test("mid-sequence failure rolls back the transitions made by the request", async () => {
    failOnContract = "0xa4";
    await expect(validator().validate(FIN_ID, { ledgerAccountId: ADDRESS })).rejects.toThrow(ValidationError);
    expect(mutations).toEqual([
      { op: "whitelist", contractAddress: "0xa1", address: ADDRESS },
      { op: "whitelist", contractAddress: "0xa4", address: ADDRESS },
      { op: "dewhitelist", contractAddress: "0xa1", address: ADDRESS },
    ]);
  });

  test("replacement records a durable stale marker and dewhitelists it only after the save", async () => {
    mappingServiceMock.getAccounts.mockResolvedValue([{ finId: FIN_ID, fields: { ledgerAccountId: OLD_ADDRESS.toLowerCase() } }]);
    const s = service();
    const validated = await new WhitelistingMappingValidator(undefined, s).validate(FIN_ID, { ledgerAccountId: ADDRESS });
    // the cleanup intent is persisted with the mapping, not held in memory
    expect(validated.staleLedgerAccountId).toBe(OLD_ADDRESS.toLowerCase());
    expect(mutations.filter(m => m.address === OLD_ADDRESS.toLowerCase())).toHaveLength(0);

    // after the row is saved (with the marker), the hook consumes it
    mappingServiceMock.getAccounts.mockResolvedValue([{ finId: FIN_ID, fields: { ledgerAccountId: ADDRESS, staleLedgerAccountId: OLD_ADDRESS.toLowerCase() } }]);
    await s.afterSave(FIN_ID);
    expect(mutations.filter(m => m.op === "dewhitelist").map(m => m.contractAddress)).toEqual(["0xa1", "0xa4"]);
    // saveAccount upserts per field, so the marker needs a field-scoped delete
    expect(mappingServiceMock.deleteAccount).toHaveBeenCalledWith(FIN_ID, "staleLedgerAccountId");
  });

  test("a failed stale cleanup keeps the marker for a later retry", async () => {
    failDewhitelistOnContract = "0xa4";
    mappingServiceMock.getAccounts.mockResolvedValue([{ finId: FIN_ID, fields: { ledgerAccountId: ADDRESS, staleLedgerAccountId: OLD_ADDRESS } }]);
    await service().afterSave(FIN_ID);
    expect(mappingServiceMock.deleteAccount).not.toHaveBeenCalled(); // marker survives
  });

  test("a leftover stale marker from a crashed attempt is retried on the next update", async () => {
    mappingServiceMock.getAccounts.mockResolvedValue([{ finId: FIN_ID, fields: { ledgerAccountId: ADDRESS, staleLedgerAccountId: OLD_ADDRESS } }]);
    await service().whitelistMappedWallet(FIN_ID, ADDRESS);
    expect(mutations.filter(m => m.op === "dewhitelist").map(m => m.address)).toEqual([OLD_ADDRESS, OLD_ADDRESS]);
  });

  test("a replaced wallet shared with another investor stays whitelisted", async () => {
    mappingServiceMock.getAccounts.mockResolvedValue([{ finId: FIN_ID, fields: { ledgerAccountId: ADDRESS, staleLedgerAccountId: OLD_ADDRESS } }]);
    mappingServiceMock.getByFieldValue.mockResolvedValue([{ finId: FIN_ID, fields: {} }, { finId: OTHER_FIN_ID, fields: {} }]);
    await service().afterSave(FIN_ID);
    expect(mutations).toHaveLength(0);
    expect(mappingServiceMock.deleteAccount).toHaveBeenCalledWith(FIN_ID, "staleLedgerAccountId"); // marker cleared, nothing to revoke
  });

  test("deactivation dewhitelists before the mapping row is deleted", async () => {
    alreadyWhitelisted.add(`0xa1:${ADDRESS.toLowerCase()}`);
    alreadyWhitelisted.add(`0xa4:${ADDRESS.toLowerCase()}`);
    mappingServiceMock.getAccounts.mockResolvedValue([{ finId: FIN_ID, fields: { ledgerAccountId: ADDRESS } }]);
    await service().beforeDelete(FIN_ID);
    expect(mutations).toEqual([
      { op: "dewhitelist", contractAddress: "0xa1", address: ADDRESS },
      { op: "dewhitelist", contractAddress: "0xa4", address: ADDRESS },
    ]);
  });

  test("a failed deactivation re-whitelists its own transitions and aborts", async () => {
    alreadyWhitelisted.add(`0xa1:${ADDRESS.toLowerCase()}`);
    alreadyWhitelisted.add(`0xa4:${ADDRESS.toLowerCase()}`);
    failDewhitelistOnContract = "0xa4";
    mappingServiceMock.getAccounts.mockResolvedValue([{ finId: FIN_ID, fields: { ledgerAccountId: ADDRESS } }]);
    await expect(service().beforeDelete(FIN_ID)).rejects.toThrow(/dewhitelisting investor .* for asset org:102:a4 failed/);
    expect(mutations).toEqual([
      { op: "dewhitelist", contractAddress: "0xa1", address: ADDRESS },
      { op: "dewhitelist", contractAddress: "0xa4", address: ADDRESS },
      { op: "whitelist", contractAddress: "0xa1", address: ADDRESS },
    ]);
  });

  test("withDewhitelistOnDelete intercepts full deletes on a foreign mapping service", async () => {
    alreadyWhitelisted.add(`0xa1:${ADDRESS.toLowerCase()}`);
    mappingServiceMock.getAccounts.mockResolvedValue([{ finId: FIN_ID, fields: { ledgerAccountId: ADDRESS } }]);
    const calls: string[] = [];
    const vanillaLike = { deleteAccount: async (finId: string) => { calls.push(`delete:${finId}`); } } as any;
    const wrapped = withDewhitelistOnDelete(vanillaLike, service());
    await wrapped.deleteAccount(FIN_ID);
    expect(mutations.map(m => m.op)).toEqual(["dewhitelist"]);
    expect(calls).toEqual([`delete:${FIN_ID}`]);
  });

  test("a new capable asset whitelists every mapped wallet", async () => {
    mappingServiceMock.getAccounts.mockResolvedValue([
      { finId: FIN_ID, fields: { ledgerAccountId: ADDRESS } },
      { finId: OTHER_FIN_ID, fields: { ledgerAccountId: OLD_ADDRESS } },
    ]);
    await service().onAssetCreated({ id: "org:102:new", contract_address: "0xnew", decimals: 2, token_standard: "WL" } as any);
    expect(mutations).toEqual([
      { op: "whitelist", contractAddress: "0xnew", address: ADDRESS },
      { op: "whitelist", contractAddress: "0xnew", address: OLD_ADDRESS },
    ]);
  });

  test("a new asset without the capability mutates nothing", async () => {
    await service().onAssetCreated({ id: "org:102:p", contract_address: "0xp", decimals: 2, token_standard: "PLAIN" } as any);
    expect(mutations).toHaveLength(0);
  });

  test("fields without an address pass through untouched", async () => {
    const validated = await validator().validate(FIN_ID, { somethingElse: "x" });
    expect(validated).toEqual({ somethingElse: "x" });
    expect(mutations).toHaveLength(0);
  });
});

describe("ChainInvestorWhitelistService (skeleton whitelist endpoints)", () => {

  const FIN_ID = "02b3e7cbe9b2e91832ea4a11a17a2e30d3cf52dae486ec1e1e3d0741e1f77210ab";
  const ESCROW = "0x9999999999999999999999999999999999999999";
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

  const mutations: Array<{ op: string; contractAddress: string; party: any }> = [];
  const whitelisted = new Set<string>(); // `${contract}:${address(lc)}`
  let refuseOnContract: string | undefined;

  beforeAll(() => {
    tokenStandardRegistry.reset();
    tokenStandardRegistry.register("WL", {
      isWhitelisted: async (asset: any, p: any) => whitelisted.has(`${asset.contractAddress}:${p.address.toLowerCase()}`),
      whitelist: async (asset: any, p: any) => {
        mutations.push({ op: "whitelist", contractAddress: asset.contractAddress, party: p });
        return asset.contractAddress === refuseOnContract
          ? { status: "failure", reason: "still blocked by internal KYC, which this standard is not configured to operate" }
          : { status: "success", transactionId: "tx", timestamp: 0 };
      },
      dewhitelist: async (asset: any, p: any) => {
        mutations.push({ op: "dewhitelist", contractAddress: asset.contractAddress, party: p });
        return { status: "success", transactionId: "tx", timestamp: 0 };
      },
    } as any);
    tokenStandardRegistry.register("PLAIN", {} as any);
  });
  afterAll(() => tokenStandardRegistry.reset());
  beforeEach(() => { mutations.length = 0; whitelisted.clear(); refuseOnContract = undefined; });

  const assets = [
    { id: "org:102:a1", contract_address: "0xa1", decimals: 2, token_standard: "WL" },
    { id: "org:102:p1", contract_address: "0xp1", decimals: 2, token_standard: "PLAIN" },
    { id: "org:102:a2", contract_address: "0xa2", decimals: 2, token_standard: "WL" },
  ] as any[];
  const assetStore = { getAsset: async (id: string) => assets.find(a => a.id === id) } as any;
  const accountMapping = { resolveAccount: async (finId: string) => finId === FIN_ID ? ADDRESS : undefined, resolveFinId: async () => undefined } as any;

  const service = () => new ChainInvestorWhitelistService(assetStore, async () => assets, accountMapping, logger);

  test("finId party resolves through the account mapping and whitelists the asset", async () => {
    const entry = await service().whitelist({ type: "finId", finId: FIN_ID }, "org:102:a1", { country: 826 });
    expect(entry).toEqual({ party: { type: "finId", finId: FIN_ID }, assetId: "org:102:a1", config: { country: 826 } });
    expect(mutations).toEqual([{
      op: "whitelist", contractAddress: "0xa1",
      party: { finId: FIN_ID, address: ADDRESS, role: "destination", country: 826 },
    }]);
  });

  test("address party (escrow wallet) whitelists without a mapping", async () => {
    await service().whitelist({ type: "address", address: ESCROW }, "org:102:a1", {});
    expect(mutations[0].party).toEqual({ address: ESCROW, role: "escrow" });
  });

  test("a standard refusal surfaces as WhitelistRefusedError, faults as throws", async () => {
    refuseOnContract = "0xa1";
    await expect(service().whitelist({ type: "finId", finId: FIN_ID }, "org:102:a1", {}))
      .rejects.toThrow(WhitelistRefusedError);
  });

  test("unknown asset and capability-less standard reject as validation errors", async () => {
    await expect(service().whitelist({ type: "finId", finId: FIN_ID }, "org:102:nope", {})).rejects.toThrow(ValidationError);
    await expect(service().whitelist({ type: "finId", finId: FIN_ID }, "org:102:p1", {})).rejects.toThrow(/no whitelisting capability/);
    await expect(service().whitelist({ type: "finId", finId: "02" + "ee".repeat(32) }, "org:102:a1", {})).rejects.toThrow(/no address mapped/);
  });

  test("dewhitelist without assetId sweeps every capable asset, counting transitions", async () => {
    whitelisted.add(`0xa1:${ADDRESS.toLowerCase()}`);
    whitelisted.add(`0xa2:${ADDRESS.toLowerCase()}`);
    const removed = await service().dewhitelist({ type: "finId", finId: FIN_ID });
    expect(removed).toBe(2);
    expect(mutations.map(m => m.contractAddress)).toEqual(["0xa1", "0xa2"]);
  });

  test("dewhitelisting an absent party removes nothing and is not an error", async () => {
    const removed = await service().dewhitelist({ type: "finId", finId: FIN_ID }, "org:102:a1");
    expect(removed).toBe(0);
    expect(mutations).toHaveLength(0);
  });

  test("getWhitelist reports chain truth for a party; no party means no answer", async () => {
    whitelisted.add(`0xa2:${ADDRESS.toLowerCase()}`);
    expect(await service().getWhitelist()).toEqual([]);
    expect(await service().getWhitelist({ type: "finId", finId: FIN_ID })).toEqual([
      { party: { type: "finId", finId: FIN_ID }, assetId: "org:102:a2", config: {} },
    ]);
    expect(await service().isWhitelisted({ type: "finId", finId: FIN_ID }, "org:102:a2")).toBe(true);
    expect(await service().isWhitelisted({ type: "finId", finId: FIN_ID }, "org:102:a1")).toBe(false);
  });
});

