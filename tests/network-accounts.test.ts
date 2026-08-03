import { AccountInvalidShapeError, storage } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { EvmNetworkAccountValidator } from "../src/services/accounts";
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

  test("create-new: generates a wallet, registers its credential, persists the row", async () => {
    const store = storeMock();
    const contract = contractMock();
    const service = new OnChainNetworkAccountService(store, contract as any, new EvmNetworkAccountValidator());

    const op = await service.createAccount("ik-1", "org", "asset", undefined);
    expect(op.type).toBe("success");
    const record = (op as any).record;
    expect(record.account.type).toBe("walletAccount");
    expect(contract.addCredential).toHaveBeenCalledTimes(1);
    const [finId, address] = contract.addCredential.mock.calls[0];
    expect(finId).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(address).toBe(record.account.address);
    expect(store.insert).toHaveBeenCalledTimes(1);
  });

  test("bind-existing: records the row without addCredential (finId gap)", async () => {
    const store = storeMock();
    const contract = contractMock();
    const service = new OnChainNetworkAccountService(store, contract as any, new EvmNetworkAccountValidator());

    const op = await service.createAccount("ik-2", "org", "asset", { account: { type: "walletAccount", address: ADDRESS } });
    expect(op.type).toBe("success");
    expect((op as any).record.account).toEqual({ type: "walletAccount", address: ADDRESS });
    expect(contract.addCredential).not.toHaveBeenCalled();
    expect(store.insert).toHaveBeenCalledTimes(1);
  });

  test("replayed create-new returns the recorded wallet without a fresh registration", async () => {
    const store = storeMock();
    store.getByIdempotencyKey.mockResolvedValue({
      accountId: "acc-1", idempotencyKey: "ik-3", organizationId: "org", assetId: "asset",
      account: { type: "walletAccount", address: ADDRESS },
    });
    const contract = contractMock();
    const service = new OnChainNetworkAccountService(store, contract as any, new EvmNetworkAccountValidator());

    const op = await service.createAccount("ik-3", "org", "asset", undefined);
    expect((op as any).record).toEqual({ id: "acc-1", account: { type: "walletAccount", address: ADDRESS } });
    expect(contract.addCredential).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();
  });
});
