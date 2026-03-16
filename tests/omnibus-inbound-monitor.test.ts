import winston from "winston";
import { OmnibusInboundMonitor } from "../src/services/omnibus/omnibus-inbound-monitor";
import { CustodyProvider, CustodyWallet } from "../src/services/direct/custody-provider";
import {
  ObservedOmnibusDeposit,
  OmnibusDepositIntent,
  OmnibusInboundStore,
  TrackedOmnibusAsset,
} from "../src/services/omnibus/store";
import { LedgerStorage } from "@owneraio/finp2p-vanilla-service";

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

function addressTopic(address: string): string {
  return `0x${"0".repeat(24)}${address.toLowerCase().slice(2)}`;
}

describe("OmnibusInboundMonitor", () => {
  const trackedAsset: TrackedOmnibusAsset = {
    assetId: "usd-token",
    assetType: "finp2p",
    tokenContractAddress: "0x00000000000000000000000000000000000000bb",
    tokenDecimals: 6,
  };

  const observed: ObservedOmnibusDeposit = {
    transactionHash: "0xTX",
    logIndex: 0,
    blockNumber: 118,
    assetId: "usd-token",
    assetType: "finp2p",
    tokenContractAddress: "0x00000000000000000000000000000000000000bb",
    tokenDecimals: 6,
    senderAddress: "0x00000000000000000000000000000000000000cc",
    recipientAddress: "0x00000000000000000000000000000000000000aa",
    amountUnits: "1500000",
    status: "detected",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const intent: OmnibusDepositIntent = {
    referenceId: "ref-1",
    destinationFinId: "investor-1",
    assetId: "usd-token",
    assetType: "finp2p",
    tokenContractAddress: "0x00000000000000000000000000000000000000bb",
    tokenDecimals: 6,
    expectedAmount: "1.5",
    expectedAmountUnits: "1500000",
    senderAddress: "0x00000000000000000000000000000000000000cc",
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let store: jest.Mocked<Pick<
    OmnibusInboundStore,
    | "expirePendingDepositIntents"
    | "listTrackedAssets"
    | "getMonitorCursor"
    | "recordObservedDeposit"
    | "saveMonitorCursor"
    | "listDetectedDeposits"
    | "listPendingDepositIntents"
    | "setObservedDepositFailureReason"
    | "markDepositIntentFulfilled"
    | "markObservedDepositFulfilled"
  >>;
  let ledgerStorage: jest.Mocked<Pick<LedgerStorage, "syncOmnibusBalance" | "ensureAccount" | "move">>;
  let custodyProvider: CustodyProvider;
  let balanceReader: { getOmnibusBalance: jest.Mock };

  beforeEach(() => {
    store = {
      expirePendingDepositIntents: jest.fn().mockResolvedValue(0),
      listTrackedAssets: jest.fn().mockResolvedValue([trackedAsset]),
      getMonitorCursor: jest.fn().mockResolvedValue(undefined),
      recordObservedDeposit: jest.fn().mockResolvedValue(undefined),
      saveMonitorCursor: jest.fn().mockResolvedValue(undefined),
      listDetectedDeposits: jest.fn().mockResolvedValue([observed]),
      listPendingDepositIntents: jest.fn().mockResolvedValue([intent]),
      setObservedDepositFailureReason: jest.fn().mockResolvedValue(undefined),
      markDepositIntentFulfilled: jest.fn().mockResolvedValue(undefined),
      markObservedDepositFulfilled: jest.fn().mockResolvedValue(undefined),
    };
    ledgerStorage = {
      syncOmnibusBalance: jest.fn().mockResolvedValue({ distributed: "0", available: "1.5" }),
      ensureAccount: jest.fn().mockResolvedValue(undefined),
      move: jest.fn().mockResolvedValue({ id: "ledger-tx" } as any),
    };
    custodyProvider = {
      issuer: createMockWallet("0x00000000000000000000000000000000000000a1"),
      escrow: createMockWallet("0x00000000000000000000000000000000000000a2"),
      omnibus: createMockWallet("0x00000000000000000000000000000000000000aa"),
      rpcProvider: {
        getBlockNumber: jest.fn().mockResolvedValue(120),
        getLogs: jest.fn().mockResolvedValue([{
          transactionHash: "0xTX",
          index: 0,
          blockNumber: 118,
          topics: [
            "0xddf252ad00000000000000000000000000000000000000000000000000000000",
            addressTopic("0x00000000000000000000000000000000000000cc"),
            addressTopic("0x00000000000000000000000000000000000000aa"),
          ],
          data: "0x16e360",
        }]),
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1 }),
      } as any,
      resolveWallet: jest.fn(),
    };
    balanceReader = {
      getOmnibusBalance: jest.fn().mockResolvedValue("1.5"),
    };
  });

  it("records and fulfills a uniquely matched observed transfer", async () => {
    const monitor = new OmnibusInboundMonitor(
      logger,
      custodyProvider,
      store as unknown as OmnibusInboundStore,
      ledgerStorage as unknown as LedgerStorage,
      balanceReader,
      { confirmations: 2, initialLookbackBlocks: 50, intervalMs: 1000 },
    );

    await monitor.runOnce();

    expect(store.recordObservedDeposit).toHaveBeenCalledWith(expect.objectContaining({
      transactionHash: "0xTX",
      amountUnits: "1500000",
      senderAddress: "0x00000000000000000000000000000000000000cc",
    }));
    expect(ledgerStorage.syncOmnibusBalance).toHaveBeenCalledWith("__omnibus__", "usd-token", "1.5", "finp2p");
    expect(ledgerStorage.move).toHaveBeenCalledWith(
      "__omnibus__",
      "investor-1",
      "1.5",
      "usd-token",
      expect.objectContaining({
        idempotency_key: "external-deposit:0xTX:0",
        operation_id: "ref-1",
      }),
      "finp2p",
    );
    expect(store.markDepositIntentFulfilled).toHaveBeenCalledWith("ref-1", "0xTX", 0);
    expect(store.markObservedDepositFulfilled).toHaveBeenCalledWith("0xTX", 0, "ref-1");
  });

  it("leaves the transfer unresolved when multiple intents match", async () => {
    store.listPendingDepositIntents.mockResolvedValue([
      intent,
      { ...intent, referenceId: "ref-2", senderAddress: "0x00000000000000000000000000000000000000cc" },
    ]);

    const monitor = new OmnibusInboundMonitor(
      logger,
      custodyProvider,
      store as unknown as OmnibusInboundStore,
      ledgerStorage as unknown as LedgerStorage,
      balanceReader,
    );

    await monitor.runOnce();

    expect(ledgerStorage.move).not.toHaveBeenCalled();
    expect(store.setObservedDepositFailureReason).toHaveBeenCalledWith(
      "0xTX",
      0,
      expect.stringContaining("Multiple pending deposit intents"),
    );
  });
});
