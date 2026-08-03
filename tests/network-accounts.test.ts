import { AccountInvalidShapeError, ValidationError, storage } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { EvmNetworkAccountValidator } from "../src/services/accounts";
import { finIdToAddress } from "@owneraio/finp2p-ethereum-orchestrator";
import { OnChainTokenService, OnChainNetworkAccountService } from "../src/services/onchain";

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
    getByIdempotencyKey: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  });

  const contractMock = () => ({
    addCredential: jest.fn().mockResolvedValue({ hash: "0x0" }),
  });

  const FIN_ID = "02b3e7cbe9b2e91832ea4a11a17a2e30d3cf52dae486ec1e1e3d0741e1f77210ab";

  test("missing finId (legacy router): throws, no chain call, no row", async () => {
    const store = storeMock();
    const contract = contractMock();
    const service = new OnChainNetworkAccountService(store, contract as any, new EvmNetworkAccountValidator());

    await expect(service.createAccount("ik-0", "org", "asset", undefined, undefined)).rejects.toThrow(ValidationError);
    await expect(service.createAccount("ik-0", "org", "asset", undefined, { account: { type: "walletAccount", address: ADDRESS } })).rejects.toThrow(ValidationError);
    expect(contract.addCredential).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();
  });

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

  test("replayed create-new returns the recorded wallet without a fresh registration", async () => {
    const store = storeMock();
    store.getByIdempotencyKey.mockResolvedValue({
      accountId: "acc-1", idempotencyKey: "ik-3", organizationId: "org", assetId: "asset", finId: FIN_ID,
      account: { type: "walletAccount", address: ADDRESS },
    });
    const contract = contractMock();
    const service = new OnChainNetworkAccountService(store, contract as any, new EvmNetworkAccountValidator());

    const op = await service.createAccount("ik-3", "org", "asset", FIN_ID, undefined);
    expect((op as any).record).toEqual({ id: "acc-1", account: { type: "walletAccount", address: ADDRESS } });
    expect(contract.addCredential).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();
  });
});
