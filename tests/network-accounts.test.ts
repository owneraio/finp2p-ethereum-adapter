import { AccountInvalidShapeError, storage } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { WhitelistParty } from "@owneraio/finp2p-ethereum-adapter-contract";
import { EvmNetworkAccountValidator } from "../src/services/accounts";
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

  const build = (store: storage.NetworkAccountStore, dewhitelistOnRemove = true) =>
    new CustodyNetworkAccountService(store, assetStore, logger, dewhitelistOnRemove, new EvmNetworkAccountValidator());

  const bind = { account: { type: "walletAccount", address: ADDRESS } as const };
  const row: storage.NetworkAccountRow = {
    accountId: "acc-1", idempotencyKey: undefined, organizationId: "org",
    assetId: WL_ASSET, finId: FIN_ID, account: bind.account,
  };

  test("create whitelists the bound wallet on the asset's standard", async () => {
    const store = storeMock();
    const op = await build(store).createAccount("ik", "org", WL_ASSET, FIN_ID, bind);
    expect(op.type).toBe("success");
    expect(store.insert).toHaveBeenCalledTimes(1);
    expect(mutations).toEqual([{
      op: "whitelist", contractAddress: "0xwl",
      party: { finId: FIN_ID, address: ADDRESS, role: "destination" },
    }]);
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

  test("whitelist failure fails the onboarding (binding kept for retry)", async () => {
    whitelistFails = true;
    const store = storeMock();
    const op = await build(store).createAccount("ik", "org", WL_ASSET, FIN_ID, bind);
    expect(op.type).toBe("failure");
    expect((op as any).error.message).toMatch(/compliance says no/);
    expect(store.insert).toHaveBeenCalledTimes(1);
  });

  test("remove dewhitelists the unbound wallet", async () => {
    const store = storeMock(row);
    const op = await build(store).removeAccount("ik", "acc-1");
    expect(op.type).toBe("success");
    expect(mutations).toEqual([{
      op: "dewhitelist", contractAddress: "0xwl",
      party: { finId: FIN_ID, address: ADDRESS, role: "destination" },
    }]);
  });

  test("dewhitelist failure restores the binding and fails the removal", async () => {
    whitelistFails = true;
    const store = storeMock(row);
    const op = await build(store).removeAccount("ik", "acc-1");
    expect(op.type).toBe("failure");
    expect(store.insert).toHaveBeenCalledWith(row);
  });

  test("omnibus (dewhitelistOnRemove=false): shared wallet is never dewhitelisted", async () => {
    const store = storeMock(row);
    const op = await build(store, false).removeAccount("ik", "acc-1");
    expect(op.type).toBe("success");
    expect(mutations).toHaveLength(0);
  });

  test("removing an absent binding stays an idempotent success", async () => {
    const op = await build(storeMock()).removeAccount("ik", "acc-x");
    expect(op.type).toBe("success");
    expect(mutations).toHaveLength(0);
  });
});
