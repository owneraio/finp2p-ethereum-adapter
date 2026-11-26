import { NonceManager, Wallet } from "ethers";
import { ERC20WithOperator__factory } from "@owneraio/finp2p-ethereum-erc20-plugin";
import { OnChainTokenService, InMemoryExecDetailsStore } from "../src/services/onchain";
import {
  RecoveringNonceManager, deployERC20WithRecovery, resetNonceOnFailure,
} from "../src/nonce-recovery";

const TOKEN = "0x" + "22".repeat(20);
const OPERATOR = "0x" + "aa".repeat(20);

const silentLogger = { debug: jest.fn(), info: jest.fn(), warning: jest.fn(), error: jest.fn(), alert: jest.fn() };

/** A wallet over a stub provider; every chain read of the nonce is counted. */
function stubWallet(chainNonce = 7) {
  const provider = { getTransactionCount: jest.fn().mockResolvedValue(chainNonce) };
  const wallet = new Wallet("0x" + "11".repeat(32)).connect(provider as any);
  jest.spyOn(wallet, "populateTransaction").mockImplementation(async (tx: any) => tx);
  return { provider, wallet };
}

const response = (nonce: number, wait: () => Promise<unknown>) =>
  ({ from: "0x" + "11".repeat(20), nonce, hash: "0x" + "ab".repeat(32), wait: jest.fn(wait) }) as any;

describe("RecoveringNonceManager", () => {
  test("successful sends use consecutive nonces from one chain read", async () => {
    const { provider, wallet } = stubWallet(7);
    const sent: number[] = [];
    jest.spyOn(wallet, "sendTransaction").mockImplementation(async (tx: any) => {
      sent.push(tx.nonce);
      return response(tx.nonce, async () => ({}));
    });
    const signer = new RecoveringNonceManager(wallet);

    await signer.sendTransaction({ to: OPERATOR });
    await signer.sendTransaction({ to: OPERATOR });

    expect(sent).toEqual([7, 8]);
    expect(provider.getTransactionCount).toHaveBeenCalledTimes(1);
  });

  test("a failed send makes the next nonce come from the chain again", async () => {
    const { provider, wallet } = stubWallet(7);
    const sendTransaction = jest.spyOn(wallet, "sendTransaction")
      .mockRejectedValueOnce(new Error("insufficient funds"))
      .mockImplementation(async (tx: any) => response(tx.nonce, async () => ({})));
    const signer = new RecoveringNonceManager(wallet);

    await expect(signer.sendTransaction({ to: OPERATOR })).rejects.toThrow("insufficient funds");
    expect(await signer.getNonce("pending")).toBe(7);
    expect(provider.getTransactionCount).toHaveBeenCalledTimes(2);
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  test("a plain NonceManager keeps the stale nonce after the same failure", async () => {
    const { provider, wallet } = stubWallet(7);
    jest.spyOn(wallet, "sendTransaction").mockRejectedValueOnce(new Error("insufficient funds"));
    const signer = new NonceManager(wallet);

    await expect(signer.sendTransaction({ to: OPERATOR })).rejects.toThrow("insufficient funds");
    expect(await signer.getNonce("pending")).toBe(8);
    expect(provider.getTransactionCount).toHaveBeenCalledTimes(1);
  });

  describe("overlapping sends", () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    /** A chain whose pending nonce counts the broadcasts it accepted; the first broadcast fails after a delay. */
    const chain = () => {
      const accepted: number[] = [];
      const provider = { getTransactionCount: jest.fn(async () => 7 + accepted.length) };
      const wallet = new Wallet("0x" + "11".repeat(32)).connect(provider as any);
      jest.spyOn(wallet, "populateTransaction").mockImplementation(async (tx: any) => { await sleep(5); return tx; });
      let broadcasts = 0;
      const attempted: number[] = [];
      jest.spyOn(wallet, "sendTransaction").mockImplementation(async (tx: any) => {
        attempted.push(tx.nonce);
        if (broadcasts++ === 0) {
          await sleep(30);
          throw new Error("insufficient funds");
        }
        accepted.push(tx.nonce);
        return response(tx.nonce, async () => ({}));
      });
      return { wallet, attempted };
    };

    test("a failed send does not leave a later send on a nonce that is still in flight", async () => {
      const { wallet, attempted } = chain();
      const signer = new RecoveringNonceManager(wallet);

      const results = await Promise.allSettled([
        signer.sendTransaction({ to: OPERATOR }),
        signer.sendTransaction({ to: OPERATOR }),
      ]);
      await signer.sendTransaction({ to: OPERATOR });

      expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
      expect(attempted).toEqual([7, 7, 8]);
    });

    test("confirmations of earlier sends do not block later sends", async () => {
      const { wallet } = stubWallet(7);
      let release: () => void = () => undefined;
      const confirmed = new Promise<void>((resolve) => { release = resolve; });
      jest.spyOn(wallet, "sendTransaction")
        .mockImplementationOnce(async (tx: any) => response(tx.nonce, async () => { await confirmed; return {}; }))
        .mockImplementation(async (tx: any) => response(tx.nonce, async () => ({})));
      const signer = new RecoveringNonceManager(wallet);

      const first = await signer.sendTransaction({ to: OPERATOR });
      const pending = first.wait();
      const second = await signer.sendTransaction({ to: OPERATOR });

      expect(second.nonce).toBe(8);
      release();
      await pending;
    });
  });

  test("connect keeps the recovering behavior", () => {
    const { provider, wallet } = stubWallet();
    expect(new RecoveringNonceManager(wallet).connect(provider as any)).toBeInstanceOf(RecoveringNonceManager);
  });
});

describe("resetNonceOnFailure", () => {
  test("a throwing operation resets the nonce and rethrows the same error", async () => {
    const { provider, wallet } = stubWallet(7);
    const signer = new NonceManager(wallet);
    await signer.getNonce("pending");
    signer.increment();
    const failure = new Error("boom");

    await expect(resetNonceOnFailure(signer, async () => { throw failure; })).rejects.toBe(failure);
    expect(await signer.getNonce("pending")).toBe(7);
    expect(provider.getTransactionCount).toHaveBeenCalledTimes(2);
  });

  test("a successful operation returns its value and keeps the cached nonce", async () => {
    const { provider, wallet } = stubWallet(7);
    const signer = new NonceManager(wallet);
    await signer.getNonce("pending");
    signer.increment();

    expect(await resetNonceOnFailure(signer, async () => "done")).toBe("done");
    expect(await signer.getNonce("pending")).toBe(8);
    expect(provider.getTransactionCount).toHaveBeenCalledTimes(1);
  });
});

describe("deployERC20WithRecovery", () => {
  beforeEach(() => {
    jest.spyOn(ERC20WithOperator__factory.prototype, "getDeployTransaction")
      .mockResolvedValue({ data: "0x6080" } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  const context = (signer: NonceManager, provider: any) =>
    ({ provider, signer, logger: silentLogger, confirmationTimeoutMs: 1000 });

  test("returns the deployed address and leaves the nonce cache alone", async () => {
    const { provider, wallet } = stubWallet(7);
    jest.spyOn(wallet, "sendTransaction").mockImplementation(async (tx: any) =>
      response(tx.nonce, async () => ({ contractAddress: TOKEN, hash: "0x1" })));
    const signer = new RecoveringNonceManager(wallet);

    expect(await deployERC20WithRecovery(context(signer, provider), "A", "A", 2, OPERATOR)).toBe(TOKEN);
    expect(await signer.getNonce("pending")).toBe(8);
    expect(provider.getTransactionCount).toHaveBeenCalledTimes(1);
  });

  test("a deployment that fails after broadcast resets the nonce and rethrows", async () => {
    const { provider, wallet } = stubWallet(7);
    jest.spyOn(wallet, "sendTransaction").mockImplementation(async (tx: any) =>
      response(tx.nonce, async () => { throw new Error("transaction reverted"); }));
    const signer = new RecoveringNonceManager(wallet);

    await expect(deployERC20WithRecovery(context(signer, provider), "A", "A", 2, OPERATOR))
      .rejects.toThrow("transaction reverted");
    expect(await signer.getNonce("pending")).toBe(7);
    expect(provider.getTransactionCount).toHaveBeenCalledTimes(2);
  });

  test("a receipt without a contract address is an error", async () => {
    const { provider, wallet } = stubWallet(7);
    jest.spyOn(wallet, "sendTransaction").mockImplementation(async (tx: any) =>
      response(tx.nonce, async () => ({ contractAddress: null, hash: "0x1" })));
    const signer = new RecoveringNonceManager(wallet);

    await expect(deployERC20WithRecovery(context(signer, provider), "A", "A", 2, OPERATOR))
      .rejects.toThrow("produced no contract address");
  });
});

describe("OnChainTokenService swap venue failures", () => {
  const INTENT = { operationId: "op" } as any;
  const service = (swap: jest.Mock) => {
    const signer = { reset: jest.fn(), increment: jest.fn(), getNonce: jest.fn() };
    const contract = { provider: {}, signer, finP2PContractAddress: OPERATOR };
    const svc = new OnChainTokenService(contract as any, undefined, new InMemoryExecDetailsStore(), undefined, undefined, "ERC20", []);
    return { svc, signer, venue: { swap } as any };
  };
  const swapAll = (svc: OnChainTokenService, venue: any, intents: any[]) => (svc as any).venueSwapAll(venue, intents);

  test("a failure result resets the operator nonce after every leg finished", async () => {
    const swap = jest.fn()
      .mockResolvedValueOnce({ status: "failure", reason: "reverted" })
      .mockResolvedValueOnce({ status: "success", transactionId: "0x1", timestamp: 1 });
    const { svc, signer, venue } = service(swap);

    const results = await swapAll(svc, venue, [INTENT, INTENT]);

    expect(results.map((r: any) => r.status)).toEqual(["failure", "success"]);
    expect(signer.reset).toHaveBeenCalledTimes(1);
  });

  test("a thrown error resets the operator nonce and propagates", async () => {
    const { svc, signer, venue } = service(jest.fn().mockRejectedValue(new Error("rpc down")));

    await expect(swapAll(svc, venue, [INTENT])).rejects.toThrow("rpc down");
    expect(signer.reset).toHaveBeenCalledTimes(1);
  });

  test("successful legs leave the nonce cache alone", async () => {
    const swap = jest.fn().mockResolvedValue({ status: "success", transactionId: "0x1", timestamp: 1 });
    const { svc, signer, venue } = service(swap);

    const results = await swapAll(svc, venue, [INTENT, INTENT]);

    expect(results).toHaveLength(2);
    expect(signer.reset).not.toHaveBeenCalled();
  });
});
