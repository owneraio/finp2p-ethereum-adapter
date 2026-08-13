import { AccountInvalidShapeError, storage } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { InvestorWhitelistServiceImpl, EvmNetworkAccountValidator } from "../src/services/accounts";
import { WalletResolutionMode } from "@owneraio/finp2p-ethereum-orchestrator";
import { OnChainTokenService, OnChainNetworkAccountService, CredentialsMappingService } from "../src/services/onchain";
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

  const build = (store: storage.NetworkAccountStore, contract: any, mode: WalletResolutionMode) =>
    new OnChainNetworkAccountService(store, contract, mode, new EvmNetworkAccountValidator());

  test("wallet-mapping: bind-existing registers the wallet in the credentials registry", async () => {
    const store = storeMock();
    const contract = contractMock();
    const op = await build(store, contract, WalletResolutionMode.WalletMapping)
      .createAccount("ik-1", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: ADDRESS } });
    expect(op.type).toBe("success");
    expect((op as any).record.account).toEqual({ type: "walletAccount", address: ADDRESS });
    expect(contract.addCredential).toHaveBeenCalledWith(FIN_ID, ADDRESS);
    expect(store.insert).toHaveBeenCalledTimes(1);
  });

  test("wallet-mapping: create-new is not supported — the adapter never derives a wallet off-chain", async () => {
    const store = storeMock();
    const contract = contractMock();
    await expect(build(store, contract, WalletResolutionMode.WalletMapping).createAccount("ik-2", "org", "asset", FIN_ID, undefined))
      .rejects.toThrow(/create-new account mode is not supported/);
    expect(contract.addCredential).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();
  });

  test("wallet-mapping: bind-existing with invalid wallet is rejected before any chain call", async () => {
    const store = storeMock();
    const contract = contractMock();
    await expect(build(store, contract, WalletResolutionMode.WalletMapping)
      .createAccount("ik-2b", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: "0x1234" } as any }))
      .rejects.toThrow(AccountInvalidShapeError);
    expect(contract.addCredential).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();
  });

  test("finId-derivation (demo): onboarding is a no-op success — no registration, nothing stored", async () => {
    const store = storeMock();
    const contract = contractMock();
    const service = build(store, contract, WalletResolutionMode.FinIdDerivation);
    const op = await service.createAccount("ik-3", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: ADDRESS } });
    expect(op.type).toBe("success");
    expect((op as any).record.account).toEqual({ type: "walletAccount", address: ADDRESS });
    expect(contract.addCredential).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();

    const removed = await service.removeAccount("ik-4", "acc-1");
    expect(removed.type).toBe("success");
    expect(store.remove).not.toHaveBeenCalled();
  });
});

describe("CredentialsMappingService wallet resolution modes", () => {

  const FIN_ID = "02b3e7cbe9b2e91832ea4a11a17a2e30d3cf52dae486ec1e1e3d0741e1f77210ab";
  const contractMock = () => ({
    addCredential: jest.fn().mockResolvedValue({ hash: "0x0" }),
    removeCredential: jest.fn().mockResolvedValue({ hash: "0x0" }),
    getCredentialAddress: jest.fn().mockResolvedValue(ADDRESS),
  });

  test("wallet-mapping: writes reach the credentials registry", async () => {
    const contract = contractMock();
    const service = new CredentialsMappingService(contract as any, WalletResolutionMode.WalletMapping);
    await service.saveAccount(FIN_ID, { ledgerAccountId: ADDRESS });
    await service.deleteAccount(FIN_ID);
    expect(contract.addCredential).toHaveBeenCalledWith(FIN_ID, ADDRESS);
    expect(contract.removeCredential).toHaveBeenCalledWith(FIN_ID);
  });

  test("finId-derivation (demo): writes are no-ops — the registry is disabled", async () => {
    const contract = contractMock();
    const service = new CredentialsMappingService(contract as any, WalletResolutionMode.FinIdDerivation);
    const saved = await service.saveAccount(FIN_ID, { ledgerAccountId: ADDRESS });
    await service.deleteAccount(FIN_ID);
    expect(saved).toEqual({ finId: FIN_ID, fields: { ledgerAccountId: ADDRESS } });
    expect(contract.addCredential).not.toHaveBeenCalled();
    expect(contract.removeCredential).not.toHaveBeenCalled();
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
    new CustodyNetworkAccountService(store, custodyProvider, mappingService, logger, undefined, new EvmNetworkAccountValidator());

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
    const service = new CustodyNetworkAccountService(store, undefined, mappingService, logger, undefined, new EvmNetworkAccountValidator());
    await expect(service.createAccount("ik", "org", "asset", FIN_ID, { account: { type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID } }))
      .rejects.toThrow(AccountInvalidShapeError);
    expect(store.insert).not.toHaveBeenCalled();
  });

  test("hedera onboarding activates the bound wallet before persisting", async () => {
    const store = storeMock();
    const activator = { ensureActivated: jest.fn().mockResolvedValue("0xactivation") } as any;
    const service = new CustodyNetworkAccountService(store, custodyProvider, mappingService, logger, activator, new EvmNetworkAccountValidator());
    const op = await service.createAccount("ik", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: ADDRESS } });
    expect(op.type).toBe("success");
    expect(activator.ensureActivated).toHaveBeenCalledWith(ADDRESS);
    expect(store.insert).toHaveBeenCalledTimes(1);
  });

  test("hedera onboarding activation failure fails the onboarding with nothing persisted", async () => {
    const store = storeMock();
    const activator = { ensureActivated: jest.fn().mockRejectedValue(new Error("gas station empty")) } as any;
    const service = new CustodyNetworkAccountService(store, custodyProvider, mappingService, logger, activator, new EvmNetworkAccountValidator());
    const op = await service.createAccount("ik", "org", "asset", FIN_ID, { account: { type: "walletAccount", address: ADDRESS } });
    expect(op.type).toBe("failure");
    expect((op as any).error.message).toMatch(/gas station empty/);
    expect(store.insert).not.toHaveBeenCalled();
    expect(mappingService.saveAccount).not.toHaveBeenCalled();
  });

  test("a custodial bind activates the resolved wallet", async () => {
    const store = storeMock();
    const activator = { ensureActivated: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new CustodyNetworkAccountService(store, custodyProvider, mappingService, logger, activator, new EvmNetworkAccountValidator());
    const op = await service.createAccount("ik", "org", "asset", FIN_ID, { account: { type: "custodialAccount", provider: "fireblocks", vaultAccountId: VAULT_ID } });
    expect(op.type).toBe("success");
    expect(activator.ensureActivated).toHaveBeenCalledWith(ADDRESS);
  });

  test("remove unbinds without touching the shared account mapping", async () => {
    const store = storeMock();
    const op = await build(store).removeAccount("ik", "acc-1");
    expect(op.type).toBe("success");
    expect(store.remove).toHaveBeenCalledWith("acc-1");
    expect(mappingService.saveAccount).not.toHaveBeenCalled();
  });
});

describe("InvestorWhitelistServiceImpl (skeleton whitelist endpoints)", () => {

  const FIN_ID = "02b3e7cbe9b2e91832ea4a11a17a2e30d3cf52dae486ec1e1e3d0741e1f77210ab";
  const ESCROW = "0x9999999999999999999999999999999999999999";
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

  const mutations: Array<{ op: string; contractAddress: string; party: any }> = [];
  const whitelisted = new Set<string>(); // `${contract}:${address(lc)}`
  let refuseOnContract: string | undefined;
  let refuseDewhitelistOnContract: string | undefined;

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
        return asset.contractAddress === refuseDewhitelistOnContract
          ? { status: "failure", reason: "holder still has balance" }
          : { status: "success", transactionId: "tx", timestamp: 0 };
      },
    } as any);
    tokenStandardRegistry.register("PLAIN", {} as any);
  });
  afterAll(() => tokenStandardRegistry.reset());
  beforeEach(() => { mutations.length = 0; whitelisted.clear(); refuseOnContract = undefined; refuseDewhitelistOnContract = undefined; });

  const assets = [
    { id: "org:102:a1", contract_address: "0xa1", decimals: 2, token_standard: "WL" },
    { id: "org:102:p1", contract_address: "0xp1", decimals: 2, token_standard: "PLAIN" },
    { id: "org:102:a2", contract_address: "0xa2", decimals: 2, token_standard: "WL" },
  ] as any[];
  const assetStore = { getAsset: async (id: string) => assets.find(a => a.id === id) } as any;
  const accountMapping = { resolveAccount: async (finId: string) => finId === FIN_ID ? ADDRESS : undefined, resolveFinId: async () => undefined } as any;

  const service = () => new InvestorWhitelistServiceImpl(assetStore, async () => assets, accountMapping, logger);

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

  test("a numeric-string country is normalized; a malformed one rejects instead of silently dropping", async () => {
    await service().whitelist({ type: "finId", finId: FIN_ID }, "org:102:a1", { country: "826" });
    expect(mutations[0].party.country).toBe(826);
    await expect(service().whitelist({ type: "finId", finId: FIN_ID }, "org:102:a1", { country: "UK" }))
      .rejects.toThrow(/ISO 3166 numeric/);
    await expect(service().whitelist({ type: "finId", finId: FIN_ID }, "org:102:a1", { country: 1826 }))
      .rejects.toThrow(/ISO 3166 numeric/);
  });

  test("a sweep attempts every asset and aggregates refusals with the removed count", async () => {
    whitelisted.add(`0xa1:${ADDRESS.toLowerCase()}`);
    whitelisted.add(`0xa2:${ADDRESS.toLowerCase()}`);
    refuseDewhitelistOnContract = "0xa1";
    await expect(service().dewhitelist({ type: "finId", finId: FIN_ID }))
      .rejects.toThrow(/refused for org:102:a1 .*— 1 asset\(s\) were removed/);
    // the refusal did not stop the later asset
    expect(mutations.filter(m => m.op === "dewhitelist").map(m => m.contractAddress)).toEqual(["0xa1", "0xa2"]);
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

