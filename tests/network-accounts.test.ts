import { AccountInvalidShapeError, storage } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { WhitelistParty } from "@owneraio/finp2p-ethereum-adapter-contract";
import { EvmNetworkAccountValidator, WhitelistingMappingValidator } from "../src/services/accounts";
import { finIdToAddress } from "@owneraio/finp2p-ethereum-orchestrator";
import { OnChainTokenService, OnChainNetworkAccountService } from "../src/services/onchain";
import { CustodyNetworkAccountService } from "../src/services/custody";
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

describe("WhitelistingMappingValidator (internal mapping API)", () => {

  const FIN_ID = "02b3e7cbe9b2e91832ea4a11a17a2e30d3cf52dae486ec1e1e3d0741e1f77210ab";
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

  const mutations: Array<{ contractAddress: string; address: string }> = [];
  let whitelistFails = false;

  beforeAll(() => {
    tokenStandardRegistry.reset();
    tokenStandardRegistry.register("WL", {
      isWhitelisted: async () => true,
      whitelist: async (asset: any, p: any) => {
        mutations.push({ contractAddress: asset.contractAddress, address: p.address });
        return whitelistFails
          ? { status: "failure", reason: "compliance says no" }
          : { status: "success", transactionId: "tx", timestamp: 0 };
      },
      dewhitelist: async () => ({ status: "success", transactionId: "tx", timestamp: 0 }),
    } as any);
    tokenStandardRegistry.register("PLAIN", {} as any);
  });
  afterAll(() => tokenStandardRegistry.reset());
  beforeEach(() => { mutations.length = 0; whitelistFails = false; });

  const assets = [
    { id: "org:102:a1", contract_address: "0xa1", decimals: 2, token_standard: "WL" },
    { id: "org:102:a2", contract_address: "0xa2", decimals: 2, token_standard: "PLAIN" },
    { id: "org:102:a3", contract_address: "0xa3", decimals: 2, token_standard: "NOT_REGISTERED" },
    { id: "org:102:a4", contract_address: "0xa4", decimals: 2, token_standard: "WL" },
  ] as any[];
  const listAssets = async () => assets;

  const build = (inner?: any) => new WhitelistingMappingValidator(inner, listAssets, logger);

  test("whitelists the mapped wallet on every capable asset, skipping the rest", async () => {
    const fields = { ledgerAccountId: ADDRESS };
    const validated = await build().validate(FIN_ID, fields);
    expect(validated).toEqual(fields);
    expect(mutations).toEqual([
      { contractAddress: "0xa1", address: ADDRESS },
      { contractAddress: "0xa4", address: ADDRESS },
    ]);
  });

  test("runs after the inner validator so an enriched address is whitelisted", async () => {
    const inner = { validate: jest.fn().mockResolvedValue({ custodyAccountId: "85", ledgerAccountId: ADDRESS }) };
    const validated = await build(inner).validate(FIN_ID, { custodyAccountId: "85" });
    expect(inner.validate).toHaveBeenCalledWith(FIN_ID, { custodyAccountId: "85" });
    expect(validated.ledgerAccountId).toBe(ADDRESS);
    expect(mutations.map(m => m.address)).toEqual([ADDRESS, ADDRESS]);
  });

  test("whitelist failure rejects the mapping request", async () => {
    whitelistFails = true;
    await expect(build().validate(FIN_ID, { ledgerAccountId: ADDRESS }))
      .rejects.toThrow(/whitelisting investor .* for asset org:102:a1 failed: compliance says no/);
  });

  test("fields without an address pass through untouched", async () => {
    const validated = await build().validate(FIN_ID, { somethingElse: "x" });
    expect(validated).toEqual({ somethingElse: "x" });
    expect(mutations).toHaveLength(0);
  });
});

describe("POST /whitelisting/dewhitelist", () => {

  const FIN_ID = "02b3e7cbe9b2e91832ea4a11a17a2e30d3cf52dae486ec1e1e3d0741e1f77210ab";
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

  const dewhitelisted: Array<{ contractAddress: string; address: string }> = [];
  let dewhitelistFails = false;

  beforeAll(() => {
    tokenStandardRegistry.reset();
    tokenStandardRegistry.register("WL", {
      isWhitelisted: async () => true,
      whitelist: async () => ({ status: "success", transactionId: "tx", timestamp: 0 }),
      dewhitelist: async (asset: any, p: any) => {
        dewhitelisted.push({ contractAddress: asset.contractAddress, address: p.address });
        return dewhitelistFails
          ? { status: "failure", reason: "still holds tokens" }
          : { status: "success", transactionId: "tx-dw", timestamp: 0 };
      },
    } as any);
    tokenStandardRegistry.register("PLAIN", {} as any);
  });
  afterAll(() => tokenStandardRegistry.reset());
  beforeEach(() => { dewhitelisted.length = 0; dewhitelistFails = false; });

  const assetStore = {
    getAsset: async (id: string) =>
      id === "org:102:wl" ? { contract_address: "0xwl", decimals: 2, token_standard: "WL", id }
        : id === "org:102:plain" ? { contract_address: "0xp", decimals: 2, token_standard: "PLAIN", id }
          : undefined,
  } as any;
  const accountMapping = { resolveAccount: async (finId: string) => finId === FIN_ID ? ADDRESS : undefined, resolveFinId: async () => undefined } as any;

  const handler = (() => {
    let h: any;
    const app = { post: (_path: string, fn: any) => { h = fn; } } as any;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerWhitelistingRoutes } = require("../src/services/accounts");
    registerWhitelistingRoutes(app, assetStore, accountMapping, logger);
    return (body: any) => new Promise<{ code: number; body: any }>((resolve) => {
      const res = {
        statusCode: 200,
        status(c: number) { this.statusCode = c; return this; },
        json(payload: any) { resolve({ code: this.statusCode, body: payload }); },
      };
      h({ body }, res);
    });
  })();

  test("dewhitelists by finId via the account mapping", async () => {
    const r = await handler({ assetId: "org:102:wl", finId: FIN_ID });
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ status: "success", address: ADDRESS, transactionId: "tx-dw" });
    expect(dewhitelisted).toEqual([{ contractAddress: "0xwl", address: ADDRESS }]);
  });

  test("dewhitelists by explicit address without a mapping lookup", async () => {
    const r = await handler({ assetId: "org:102:wl", address: "0x9999999999999999999999999999999999999999" });
    expect(r.code).toBe(200);
    expect(dewhitelisted[0].address).toBe("0x9999999999999999999999999999999999999999");
  });

  test("standard-reported failure surfaces as 422", async () => {
    dewhitelistFails = true;
    const r = await handler({ assetId: "org:102:wl", finId: FIN_ID });
    expect(r.code).toBe(422);
    expect(r.body.reason).toMatch(/still holds tokens/);
  });

  test("unknown asset is 404, capability-less standard and bad input are 400", async () => {
    expect((await handler({ assetId: "org:102:nope", finId: FIN_ID })).code).toBe(404);
    expect((await handler({ assetId: "org:102:plain", finId: FIN_ID })).code).toBe(400);
    expect((await handler({ assetId: "org:102:wl" })).code).toBe(400);
    expect((await handler({ assetId: "org:102:wl", finId: "02" + "ee".repeat(32) })).code).toBe(404);
    expect(dewhitelisted).toHaveLength(0);
  });
});
