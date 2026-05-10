import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { NonceManager, Wallet } from "ethers";
import { ContractsManager } from "../src/manager";
import { Logger } from "../src/adapter-types";

/**
 * Hardhat-network unit test for the safeExecuteTransaction nonce-recovery
 * mechanism in `manager.ts`. Mirrors the real-Sepolia diagnostic in
 * `tests/nonce-recovery-sepolia.test.ts` but runs in-memory so it stays
 * cheap, deterministic, and CI-friendly.
 *
 * Scenario: two NonceManager instances wrap the same operator key; both
 * prime their internal caches (cachedNonce = N); A submits a tx → A.cache
 * = N+1, on-chain = N+1, B.cache stale at N. B then submits via the
 * wrapper — first attempt fails on a nonce-already-used type error;
 * detectError categorizes it; the wrapper calls `NonceManager.reset()`
 * on B and retries; second attempt succeeds.
 *
 * Assertions:
 *   • B's call returns a successful receipt (no throw).
 *   • On-chain nonce moved by exactly 2 (one from A, one from the
 *     successfully-retried B).
 */

// Hardhat default account 0 — the deployer / DEFAULT_ADMIN_ROLE holder
// on freshly-deployed FINP2POperator instances.
const HARDHAT_DEFAULT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Silent logger so test output stays focused on assertions.
const silentLogger: Logger = {
  info: () => {},
  debug: () => {},
  warning: () => {},
  error: () => {},
} as unknown as Logger;

describe("safeExecuteTransaction nonce recovery (hardhat)", function () {

  it("two managers sharing a key: wrapper detects+resets+retries on stale nonce, B succeeds", async () => {
    const provider = ethers.provider;

    // Deploy a FINP2POperator the operator key has admin role on, so
    // grantAssetManagerRole (the public method we use as a "go through
    // safeExecuteTransaction" probe) is callable. The operator key
    // matches hardhat account 0 → the deployer → DEFAULT_ADMIN_ROLE.
    const factory = await ethers.getContractFactory("FINP2POperator");
    const operatorAddress = new Wallet(HARDHAT_DEFAULT_KEY).address;
    const finP2P = await factory.deploy(operatorAddress);
    const finP2PAddress = await finP2P.getAddress();

    // Two NonceManager instances, same operator key.
    const signerA = new NonceManager(new Wallet(HARDHAT_DEFAULT_KEY)).connect(provider);
    const signerB = new NonceManager(new Wallet(HARDHAT_DEFAULT_KEY)).connect(provider);
    const managerA = new ContractsManager(provider, signerA, silentLogger);
    const managerB = new ContractsManager(provider, signerB, silentLogger);

    // Both prime their nonce caches against on-chain state.
    const cachedA = await signerA.getNonce();
    const cachedB = await signerB.getNonce();
    expect(cachedA).to.equal(cachedB);

    const startingOnchain = await provider.getTransactionCount(operatorAddress, "latest");

    // A submits via the wrapper — chain nonce moves from N to N+1, A.cache to N+1.
    await managerA.grantAssetManagerRole(finP2PAddress, operatorAddress);
    const onchainAfterA = await provider.getTransactionCount(operatorAddress, "latest");
    expect(onchainAfterA).to.equal(startingOnchain + 1);

    // B's cache is still at N (stale). Submit through the wrapper.
    // First attempt MUST fail with a nonce-already-used type error;
    // safeExecuteTransaction must detect, reset B, retry, and succeed.
    let bError: any = undefined;
    try {
      await managerB.grantAssetManagerRole(finP2PAddress, operatorAddress);
    } catch (e) {
      bError = e;
    }
    expect(bError, `wrapper should have recovered, got ${bError?.message ?? bError}`).to.be.undefined;

    const onchainAfterB = await provider.getTransactionCount(operatorAddress, "latest");
    expect(onchainAfterB).to.equal(startingOnchain + 2);
  });

  it("when only one manager is in play: nonce conflict cannot occur — sanity baseline", async () => {
    // Sanity: a single manager's wrapped call moves the chain nonce by 1
    // every time. Confirms the test's "starting state" assumptions are
    // correct and the fixture isn't already broken.
    const provider = ethers.provider;
    const factory = await ethers.getContractFactory("FINP2POperator");
    const operatorAddress = new Wallet(HARDHAT_DEFAULT_KEY).address;
    const finP2P = await factory.deploy(operatorAddress);
    const finP2PAddress = await finP2P.getAddress();

    const signer = new NonceManager(new Wallet(HARDHAT_DEFAULT_KEY)).connect(provider);
    const manager = new ContractsManager(provider, signer, silentLogger);

    const start = await provider.getTransactionCount(operatorAddress, "latest");
    await manager.grantAssetManagerRole(finP2PAddress, operatorAddress);
    await manager.grantTransactionManagerRole(finP2PAddress, operatorAddress);
    const end = await provider.getTransactionCount(operatorAddress, "latest");
    expect(end - start).to.equal(2);
  });
});
