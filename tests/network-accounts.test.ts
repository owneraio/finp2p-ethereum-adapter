import { AccountInvalidShapeError, storage } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { EvmNetworkAccountValidator } from "../src/services/accounts";
import { finIdToAddress } from "@owneraio/finp2p-ethereum-orchestrator";
import { OnChainTokenService, OnChainNetworkAccountService } from "../src/services/onchain";
import { CustodyNetworkAccountService } from "../src/services/custody";

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

describe("CustodyNetworkAccountService onboarding", () => {

  const FIN_ID = "02b3e7cbe9b2e91832ea4a11a17a2e30d3cf52dae486ec1e1e3d0741e1f77210ab";
  const VAULT_ID = "85";
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

  const storeMock = (): jest.Mocked<storage.NetworkAccountStore> => ({
    insert: jest.fn().mockImplementation(async (row) => row),
    getByFinId: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  });

  const custodyProvider = {
    resolveAddressFromCustodyId: jest.fn().mockImplementation(async (id: string) => {
      if (id !== VAULT_ID) throw new Error(`No deposit address found for vault ${id}`);
      return ADDRESS;
    }),
  } as any;
  const mappingService = { saveAccount: jest.fn().mockResolvedValue(undefined) } as any;
  beforeEach(() => { custodyProvider.resolveAddressFromCustodyId.mockClear(); mappingService.saveAccount.mockClear(); });

  const build = (store: storage.NetworkAccountStore) =>
    new CustodyNetworkAccountService(store, custodyProvider, mappingService, logger, new EvmNetworkAccountValidator());

  test("EVM wallet bind: recorded as-is and mirrored into the account mapping", async () => {
    const store = storeMock();
    const op = await build(store).createAccount("ik", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: ADDRESS } });
    expect(op.type).toBe("success");
    expect(store.insert).toHaveBeenCalledTimes(1);
    expect(mappingService.saveAccount).toHaveBeenCalledWith(FIN_ID, { ledgerAccountId: ADDRESS });
  });

  test("custodialAccount bind: vault id resolved via the provider, mirrored with both fields", async () => {
    const store = storeMock();
    const op = await build(store).createAccount("ik", "org", "asset", FIN_ID,
      { account: { type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID } });
    expect(op.type).toBe("success");
    expect((op as any).record.account).toEqual({ type: "walletAccount", address: ADDRESS });
    expect(custodyProvider.resolveAddressFromCustodyId).toHaveBeenCalledWith(VAULT_ID);
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ account: { type: "walletAccount", address: ADDRESS } }));
    expect(mappingService.saveAccount).toHaveBeenCalledWith(FIN_ID, { ledgerAccountId: ADDRESS, custodyAccountId: VAULT_ID });
  });

  test("non-EVM walletAccount address binds as a custody account id (temporary overload)", async () => {
    const store = storeMock();
    const op = await build(store).createAccount("ik", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: VAULT_ID } });
    expect(op.type).toBe("success");
    expect((op as any).record.account).toEqual({ type: "walletAccount", address: ADDRESS });
    expect(mappingService.saveAccount).toHaveBeenCalledWith(FIN_ID, { ledgerAccountId: ADDRESS, custodyAccountId: VAULT_ID });
  });

  test("unresolvable custody account id is rejected before any persistence", async () => {
    const store = storeMock();
    await expect(build(store).createAccount("ik", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: "no-such-vault" } }))
      .rejects.toThrow(AccountInvalidShapeError);
    expect(store.insert).not.toHaveBeenCalled();
    expect(mappingService.saveAccount).not.toHaveBeenCalled();
  });

  test("custody-id bind without a resolving provider is rejected", async () => {
    const store = storeMock();
    const service = new CustodyNetworkAccountService(store, undefined, mappingService, logger, new EvmNetworkAccountValidator());
    await expect(service.createAccount("ik", "org", "asset", FIN_ID, { account: { type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID } }))
      .rejects.toThrow(AccountInvalidShapeError);
    expect(store.insert).not.toHaveBeenCalled();
  });

  test("remove unbinds without touching the shared account mapping", async () => {
    const store = storeMock();
    const op = await build(store).removeAccount("ik", "acc-1");
    expect(op.type).toBe("success");
    expect(store.remove).toHaveBeenCalledWith("acc-1");
    expect(mappingService.saveAccount).not.toHaveBeenCalled();
  });
});
