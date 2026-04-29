/**
 * Fireblocks + omnibus + ETH integration tests for the deposit-method plugins.
 *
 * Flow per method (pull, ota):
 *   1. Boot the adapter wired to Fireblocks-omnibus + a mocked FinP2PClient.
 *   2. Bind the asset to the existing Sepolia USDC contract via /assets/create.
 *   3. Call /payments/depositInstruction → receive the deposit target address
 *      (operator address for pull, ephemeral one-time address for ota).
 *   4. Donor vault sends USDC:
 *        - ota:  ERC20 transfer donor → ephemeral
 *        - pull: ERC20 approve(operator, amount) from donor; adapter pulls into omnibus
 *   5. Poll until omnibus USDC balance increases AND mock FinAPI captured an
 *      importTransactions call for the deposit.
 *   6. Assert receipt fields, swept-balance is zero (ota), and the ephemeral
 *      vault was archived.
 *
 * Requires real Fireblocks credentials + a donor vault funded with USDC + ETH.
 * Run with: npm run test:deposits-omnibus
 */

import http from "http";
import { Contract, JsonRpcProvider } from "ethers";
import { FireblocksSDK, PeerType, TransactionOperation, TransactionStatus } from "fireblocks-sdk";
import { ApiBaseUrl, ChainId } from "@fireblocks/fireblocks-web3-provider";
import winston, { format, transports } from "winston";
import createApp, { WorkflowsConfig } from "../src/app";
import { FireblocksAppConfig, createFireblocksEthersProvider } from "../src/integrations/fireblocks/config";
import { randomPort } from "./utils/utils";

declare const fireblocksConfig: {
  apiKey: string;
  apiPrivateKey: string;
  apiBaseUrl: ApiBaseUrl;
  chainId: ChainId;
  operatorVaultId: string;
  omnibusVaultId: string;
  donorVaultId: string;
  gasFundingVaultId: string;
  gasFundingAmount: string;
  usdcAssetId: string;
  usdcContractAddress: string;
  omnibusAddress: string;
  donorAddress: string;
};
declare const connectionString: string;
declare const gooseExecutablePath: string;

const ASSET_ID_OTA = "USDC-OMNIBUS-OTA";
const ASSET_ID_PULL = "USDC-OMNIBUS-PULL";
const TEST_INVESTOR_FIN_ID = "0376339d3cd3c44d704d27cfba39e13234732f47f2d10927c4f3a7b5032daa3649";
const TEST_ISSUER_FIN_ID = "0341bf2178bc4e047f5782f3a25ed4ffd742edf4604ba22ae2f771036d3e4a6710";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console({ level: "info" })],
  format: format.json(),
});

interface CapturedReceipt {
  txs: any[];
}

function makeMockFinP2PClient(captured: CapturedReceipt[]): any {
  return {
    importTransactions: async (txs: any[]) => {
      captured.push({ txs });
      return { ok: true };
    },
    // The workflow proxy invokes sendCallback after every wrapped op; provide a no-op
    // so we don't get noisy "Failed to send callback to router" logs.
    sendCallback: async () => undefined,
  };
}

async function startAdapter(depositMethod: "pull" | "ota", finP2PClientMock: any): Promise<{ url: string; close: () => Promise<void> }> {
  process.env.DEPOSIT_METHOD = depositMethod;

  const { provider, signer } = await createFireblocksEthersProvider({
    apiKey: fireblocksConfig.apiKey,
    privateKey: fireblocksConfig.apiPrivateKey,
    chainId: fireblocksConfig.chainId,
    apiBaseUrl: fireblocksConfig.apiBaseUrl as string,
    vaultAccountIds: [fireblocksConfig.operatorVaultId],
  });

  const appConfig: FireblocksAppConfig = {
    type: "fireblocks",
    orgId: "test-org",
    provider,
    signer,
    finP2PClient: finP2PClientMock,
    proofProvider: undefined,
    accountMappingType: "database",
    accountModel: "omnibus",
    apiKey: fireblocksConfig.apiKey,
    apiPrivateKey: fireblocksConfig.apiPrivateKey,
    chainId: fireblocksConfig.chainId,
    apiBaseUrl: fireblocksConfig.apiBaseUrl,
    assetIssuerVaultId: fireblocksConfig.operatorVaultId,
    assetEscrowVaultId: fireblocksConfig.operatorVaultId,
    omnibusVaultId: fireblocksConfig.omnibusVaultId,
    gasFunding: {
      vaultId: fireblocksConfig.gasFundingVaultId,
      amount: fireblocksConfig.gasFundingAmount,
    },
  };

  const workflowsConfig: WorkflowsConfig = {
    migration: {
      connectionString,
      gooseExecutablePath,
      migrationListTableName: "deposit_omnibus_test_migrations",
      storageUser: new URL(connectionString).username,
    },
    finP2PClient: finP2PClientMock,
  };

  const port = randomPort();
  const app = await createApp(workflowsConfig, logger, appConfig, connectionString);
  const server: http.Server = app.listen(port);
  await new Promise<void>((res) => server.once("listening", () => res()));

  const readiness = await fetch(`http://localhost:${port}/health/readiness`);
  if (!readiness.ok) throw new Error(`adapter not ready: ${await readiness.text()}`);

  return {
    url: `http://localhost:${port}/api`,
    close: () =>
      new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
  };
}

async function postJson(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": String(Date.now()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function bindAsset(adapterUrl: string, assetId: string): Promise<void> {
  await postJson(`${adapterUrl}/assets/create`, {
    asset: { resourceId: assetId },
    ledgerAssetBinding: {
      tokenId: fireblocksConfig.usdcContractAddress,
      network: "sepolia",
      standard: "ERC20",
    },
    name: "USDC (test)",
    issuerId: TEST_ISSUER_FIN_ID,
    denomination: { type: "fiat", code: "USD" },
  });
}

async function requestDeposit(adapterUrl: string, assetId: string, amount: string): Promise<{ walletAddress: string; operationId: string; cid: string; custodyAccountId: string | undefined }> {
  const resp = await postJson(`${adapterUrl}/payments/depositInstruction/`, {
    owner: { finId: TEST_INVESTOR_FIN_ID },
    destination: { finId: TEST_INVESTOR_FIN_ID },
    asset: { type: "finp2p", resourceId: assetId },
    amount,
  });
  // The workflow proxy returns { isCompleted: false, cid } and runs the call async,
  // persisting the result. Either we already have `response`, or we poll status.
  let depositOp = resp;
  if (!depositOp?.response && !depositOp?.error) {
    if (!resp?.cid) throw new Error(`depositInstruction had no cid in pending response: ${JSON.stringify(resp)}`);
    depositOp = await waitForDepositCompletion(adapterUrl, resp.cid);
  }
  if (depositOp?.error && Object.keys(depositOp.error).length > 0) {
    throw new Error(`depositInstruction failed: ${JSON.stringify(depositOp.error)}`);
  }
  const instr = depositOp?.response;
  const opt = instr?.paymentOptions?.[0];
  const walletAddress = opt?.methodInstruction?.walletAddress;
  if (!walletAddress) {
    throw new Error(`depositInstruction returned no walletAddress: ${JSON.stringify(depositOp)}`);
  }
  return {
    walletAddress,
    operationId: instr?.operationId,
    cid: resp.cid,
    custodyAccountId: instr?.details?.custodyAccountId,
  };
}

async function waitForDepositCompletion(adapterUrl: string, cid: string): Promise<any> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const res = await fetch(`${adapterUrl}/operations/status/${cid}`);
    if (res.ok) {
      const body = await res.json() as any;
      const op = body?.operation ?? body;
      if (op?.isCompleted) return op;
    }
    await sleep(200);
  }
  throw new Error(`Operation ${cid} did not complete in time`);
}

async function donorTransferUsdc(sdk: FireblocksSDK, toAddress: string, amount: string): Promise<string> {
  const tx = await sdk.createTransaction({
    operation: TransactionOperation.TRANSFER,
    assetId: fireblocksConfig.usdcAssetId,
    source: { type: PeerType.VAULT_ACCOUNT, id: fireblocksConfig.donorVaultId },
    destination: { type: PeerType.ONE_TIME_ADDRESS, oneTimeAddress: { address: toAddress } },
    amount,
    note: "deposit-omnibus-test: donor → ephemeral",
  });
  return waitForFireblocksTx(sdk, tx.id);
}

async function donorApproveUsdc(spender: string, amount: bigint): Promise<string> {
  // Use fireblocks-web3-provider (via the adapter's helper) to make the donor vault
  // sign an ERC20 approve.
  const { signer } = await createFireblocksEthersProvider({
    apiKey: fireblocksConfig.apiKey,
    privateKey: fireblocksConfig.apiPrivateKey,
    chainId: fireblocksConfig.chainId,
    apiBaseUrl: fireblocksConfig.apiBaseUrl as string,
    vaultAccountIds: [fireblocksConfig.donorVaultId],
  });
  const usdc = new Contract(fireblocksConfig.usdcContractAddress, ERC20_ABI, signer);
  const tx = await usdc.approve(spender, amount);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`donor approve failed: ${tx.hash}`);
  return receipt.hash;
}

async function waitForFireblocksTx(sdk: FireblocksSDK, txId: string): Promise<string> {
  const TERMINAL_FAIL: TransactionStatus[] = [
    TransactionStatus.FAILED,
    TransactionStatus.BLOCKED,
    TransactionStatus.CANCELLED,
    TransactionStatus.REJECTED,
  ];
  for (let i = 0; i < 200; i++) {
    const info = await sdk.getTransactionById(txId);
    if (info.status === TransactionStatus.COMPLETED) return info.txHash || txId;
    if (TERMINAL_FAIL.includes(info.status)) {
      throw new Error(`Fireblocks tx ${txId} reached terminal status ${info.status}`);
    }
    await sleep(3000);
  }
  throw new Error(`Fireblocks tx ${txId} did not complete in time`);
}

async function readUsdcBalance(provider: JsonRpcProvider, address: string): Promise<bigint> {
  const usdc = new Contract(fireblocksConfig.usdcContractAddress, ERC20_ABI, provider);
  return await usdc.balanceOf(address) as bigint;
}

async function pollUntil<T>(label: string, fn: () => Promise<T | undefined>, timeoutMs = 300000, intervalMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v !== undefined) return v;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("Fireblocks + omnibus deposit plugins", () => {
  const captured: CapturedReceipt[] = [];
  let adapter: { url: string; close: () => Promise<void> } | undefined;
  let provider: JsonRpcProvider;
  let fireblocksSdk: FireblocksSDK;

  beforeAll(() => {
    fireblocksSdk = new FireblocksSDK(fireblocksConfig.apiPrivateKey, fireblocksConfig.apiKey, fireblocksConfig.apiBaseUrl as string);
    const networkUrl = process.env.SEPOLIA_RPC_URL || process.env.NETWORK_HOST;
    if (!networkUrl) throw new Error("SEPOLIA_RPC_URL (or NETWORK_HOST) must point to a Sepolia RPC for balance assertions");
    provider = new JsonRpcProvider(networkUrl);
  });

  afterEach(async () => {
    captured.length = 0;
    if (adapter) {
      await adapter.close();
      adapter = undefined;
    }
  });

  describe("ota-deposit", () => {
    it("sweeps a donor transfer to omnibus and reports a receipt", async () => {
      adapter = await startAdapter("ota", makeMockFinP2PClient(captured));

      await bindAsset(adapter.url, ASSET_ID_OTA);

      const amount = "100000"; // 0.1 USDC (6 decimals)
      const omnibusBefore = await readUsdcBalance(provider, fireblocksConfig.omnibusAddress);

      const { walletAddress: ephemeral, custodyAccountId } = await requestDeposit(adapter.url, ASSET_ID_OTA, amount);
      expect(ephemeral).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(ephemeral.toLowerCase()).not.toBe(fireblocksConfig.omnibusAddress.toLowerCase());
      expect(custodyAccountId).toBeDefined();

      logger.info(`[ota] donor → ephemeral ${ephemeral} (${amount})`);
      await donorTransferUsdc(fireblocksSdk, ephemeral, "0.1");

      // Wait until the mock has the receipt; the watcher fires this only after the
      // sweep tx (when a gas-station is configured). Then verify the full lifecycle.
      const receipt = await pollUntil(
        "FinAPI receipt",
        async () => (captured.length > 0 ? captured[0] : undefined),
        600000,
      );

      const ephemeralAfter = await readUsdcBalance(provider, ephemeral);
      const omnibusAfter = await readUsdcBalance(provider, fireblocksConfig.omnibusAddress);
      logger.info(`[ota] result: ephemeralAfter=${ephemeralAfter} omnibusDelta=${omnibusAfter - omnibusBefore}`);

      expect(ephemeralAfter).toBe(0n);
      expect(omnibusAfter - omnibusBefore).toBe(BigInt(amount));

      expect(receipt.txs).toHaveLength(1);
      const tx = receipt.txs[0];
      expect(tx.quantity).toBe(amount);
      expect(tx.destination?.finp2pAccount?.account?.finId).toBe(TEST_INVESTOR_FIN_ID);
      expect(tx.destination?.finp2pAccount?.asset?.id).toBe(ASSET_ID_OTA);

      // Archive verification: Fireblocks archive = hideVaultAccount → vault.hiddenOnUI=true.
      // archiveCustodyAccount runs AFTER exportReceipt fires (which is what `captured` signals),
      // so poll the vault state instead of asserting it synchronously.
      await pollUntil(
        "vault archived",
        async () => {
          const v = await fireblocksSdk.getVaultAccountById(custodyAccountId!);
          return v.hiddenOnUI ? v : undefined;
        },
        30000,
        1000,
      );
    }, 600000);
  });

  describe("pull-deposit", () => {
    it("pulls an approved transfer into omnibus and reports a receipt", async () => {
      adapter = await startAdapter("pull", makeMockFinP2PClient(captured));

      await bindAsset(adapter.url, ASSET_ID_PULL);

      const amount = "100000"; // 0.1 USDC
      const omnibusBefore = await readUsdcBalance(provider, fireblocksConfig.omnibusAddress);

      const { walletAddress: spender } = await requestDeposit(adapter.url, ASSET_ID_PULL, amount);
      expect(spender).toMatch(/^0x[a-fA-F0-9]{40}$/);

      logger.info(`[pull] donor approving spender=${spender} amount=${amount}`);
      await donorApproveUsdc(spender, BigInt(amount));

      // Pull can retry the watcher → transferFrom cycle several times when the
      // operator's gas-funding tx hasn't settled. Allow up to 14 min so the inner
      // poll doesn't fire before the jest test timeout (900s) does.
      const receipt = await pollUntil(
        "FinAPI receipt",
        async () => (captured.length > 0 ? captured[0] : undefined),
        840000,
      );

      const omnibusAfter = await readUsdcBalance(provider, fireblocksConfig.omnibusAddress);
      logger.info(`[pull] result: omnibusDelta=${omnibusAfter - omnibusBefore}`);
      expect(omnibusAfter - omnibusBefore).toBe(BigInt(amount));

      expect(receipt.txs).toHaveLength(1);
      const tx = receipt.txs[0];
      expect(tx.quantity).toBe(amount);
      expect(tx.destination?.finp2pAccount?.account?.finId).toBe(TEST_INVESTOR_FIN_ID);
      expect(tx.destination?.finp2pAccount?.asset?.id).toBe(ASSET_ID_PULL);
    }, 900000);
  });
});
