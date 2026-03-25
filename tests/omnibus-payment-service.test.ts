import winston from "winston";
import { OmnibusPaymentService } from "../src/services/omnibus/omnibus-payment-service";
import { CustodyProvider, CustodyWallet } from "../src/services/direct/custody-provider";
import { OmnibusInboundStore } from "../src/services/omnibus/store";

const mockGetAsset = jest.fn();

jest.mock("@owneraio/finp2p-nodejs-skeleton-adapter", () => ({
  workflows: {
    getAsset: (...args: any[]) => mockGetAsset(...args),
  },
}));

const logger = winston.createLogger({ silent: true });

function createMockSigner(address: string) {
  return { getAddress: jest.fn().mockResolvedValue(address) } as any;
}

function createMockWallet(address: string): CustodyWallet {
  return {
    provider: {} as any,
    signer: createMockSigner(address),
  };
}

function createMockCustodyProvider(): CustodyProvider {
  return {
    issuer: createMockWallet("0x00000000000000000000000000000000000000a1"),
    escrow: createMockWallet("0x00000000000000000000000000000000000000a2"),
    omnibus: createMockWallet("0x00000000000000000000000000000000000000aa"),
    rpcProvider: {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 8453n }),
    } as any,
    resolveWallet: jest.fn(),
  };
}

describe("OmnibusPaymentService", () => {
  const destination = {
    finId: "investor-1",
    account: { type: "finId", finId: "investor-1" as const },
  };
  const dbAsset = {
    id: "usd-token",
    type: "finp2p",
    contract_address: "0xTOKEN",
    decimals: 6,
    token_standard: "ERC20" as const,
  };

  let store: jest.Mocked<Pick<OmnibusInboundStore, "createDepositIntent">>;
  let service: OmnibusPaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAsset.mockResolvedValue(dbAsset);
    store = {
      createDepositIntent: jest.fn().mockResolvedValue(undefined),
    };
    service = new OmnibusPaymentService(
      logger,
      createMockCustodyProvider(),
      store as unknown as OmnibusInboundStore,
      { intentTtlMs: 60_000 },
    );
  });

  it("creates a deposit intent and returns ERC-20 omnibus transfer instructions", async () => {
    const result = await service.getDepositInstruction(
      "idem-1",
      { finId: "requestor", account: { type: "finId", finId: "requestor" } } as any,
      destination as any,
      { assetId: "usd-token", assetType: "finp2p" },
      "1.5",
      { senderAddress: "0xSender" },
      undefined,
      undefined,
    );

    expect(result.operation).toBe("deposit");
    expect(result.type).toBe("success");
    if (result.type !== "success") throw new Error("expected success");
    expect(result.instruction.operationId).toBeDefined();
    expect(result.instruction.account.finId).toBe("investor-1");
    expect(result.instruction.paymentOptions[0].currency).toBe("usd-token");
    expect(result.instruction.paymentOptions[0].methodInstruction).toEqual({
      type: "cryptoTransfer",
      network: "eip155:8453",
      contractAddress: "0xTOKEN",
      walletAddress: "0x00000000000000000000000000000000000000aa",
    });
    expect(store.createDepositIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationFinId: "investor-1",
        assetId: "usd-token",
        tokenContractAddress: "0xTOKEN",
        expectedAmount: "1.5",
        expectedAmountUnits: "1500000",
        senderAddress: "0xsender",
      }),
    );
  });

  it("fails when amount is missing", async () => {
    const result = await service.getDepositInstruction(
      "idem-2",
      { finId: "requestor", account: { type: "finId", finId: "requestor" } } as any,
      destination as any,
      { assetId: "usd-token", assetType: "finp2p" },
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(result.operation).toBe("deposit");
    expect(result.type).toBe("failure");
    if (result.type !== "failure") throw new Error("expected failure");
    expect(result.error.message).toContain("Amount is required");
    expect(store.createDepositIntent).not.toHaveBeenCalled();
  });
});
