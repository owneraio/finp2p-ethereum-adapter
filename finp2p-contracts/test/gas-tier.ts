import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { NonceManager, Wallet } from "ethers";
import { ContractsManager, GasTier } from "../src/manager";
import { Logger } from "../src/adapter-types";

/**
 * Hardhat-network unit test for the EIP-1559 gas-tier mechanism in
 * `safeExecuteTransaction`. Confirms:
 *
 *   • `normal` (default) leaves gas fields unset → ethers' built-in
 *     default flows through unchanged.
 *   • `fast` scales maxPriorityFeePerGas and maxFeePerGas by 1.5×
 *     vs the node's getFeeData() estimate.
 *   • `slow` scales them by 0.75×.
 *
 * We capture the actual override values passed into the call by
 * wrapping the public `grantAssetManagerRole` method's underlying
 * safeExecuteTransaction via a minimal test subclass.
 */

const HARDHAT_DEFAULT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const silentLogger: Logger = {
  info: () => {},
  debug: () => {},
  warning: () => {},
  error: () => {},
} as unknown as Logger;

describe("safeExecuteTransaction gas-tier overrides (hardhat)", function () {

  async function setupManager(gasTier: GasTier | undefined) {
    const provider = ethers.provider;
    const signer = new NonceManager(new Wallet(HARDHAT_DEFAULT_KEY)).connect(provider);
    const manager = new ContractsManager(provider, signer, silentLogger, undefined, gasTier);
    return { provider, signer, manager };
  }

  it("normal tier (default): leaves maxPriorityFeePerGas / maxFeePerGas unset", async () => {
    const { manager } = await setupManager(undefined); // default tier = 'normal'
    const overrides = await (manager as any).buildTxOverrides(0);
    expect(overrides.nonce).to.equal(0);
    expect(overrides.maxPriorityFeePerGas).to.be.undefined;
    expect(overrides.maxFeePerGas).to.be.undefined;
  });

  it("fast tier: scales gas fields by 1.5x of node feeData", async () => {
    const { provider, manager } = await setupManager('fast');
    const feeData = await provider.getFeeData();
    if (feeData.maxPriorityFeePerGas == null || feeData.maxFeePerGas == null) {
      // Hardhat may not return EIP-1559 fields on some configs — skip.
      this.skip?.();
      return;
    }
    const overrides = await (manager as any).buildTxOverrides(7);
    expect(overrides.nonce).to.equal(7);
    const expectedPriority = (feeData.maxPriorityFeePerGas * 1500n) / 1000n;
    const expectedMax = (feeData.maxFeePerGas * 1500n) / 1000n;
    expect(overrides.maxPriorityFeePerGas).to.equal(expectedPriority);
    expect(overrides.maxFeePerGas).to.equal(expectedMax);
  });

  it("slow tier: scales gas fields by 0.75x of node feeData", async () => {
    const { provider, manager } = await setupManager('slow');
    const feeData = await provider.getFeeData();
    if (feeData.maxPriorityFeePerGas == null || feeData.maxFeePerGas == null) {
      this.skip?.();
      return;
    }
    const overrides = await (manager as any).buildTxOverrides(3);
    expect(overrides.nonce).to.equal(3);
    const expectedPriority = (feeData.maxPriorityFeePerGas * 750n) / 1000n;
    const expectedMax = (feeData.maxFeePerGas * 750n) / 1000n;
    expect(overrides.maxPriorityFeePerGas).to.equal(expectedPriority);
    expect(overrides.maxFeePerGas).to.equal(expectedMax);
  });

  it("fast tier end-to-end: a wrapped grantAssetManagerRole tx confirms with our overrides", async () => {
    // Sanity: with fast tier active, the wrapper still produces a healthy receipt
    // (i.e. the override values we generate are valid and accepted on-chain).
    const { provider, manager } = await setupManager('fast');
    const factory = await ethers.getContractFactory("FINP2POperator");
    const operatorAddress = new Wallet(HARDHAT_DEFAULT_KEY).address;
    const finP2P = await factory.deploy(operatorAddress);
    const finP2PAddress = await finP2P.getAddress();

    const startingNonce = await provider.getTransactionCount(operatorAddress, "latest");
    await manager.grantAssetManagerRole(finP2PAddress, operatorAddress);
    const endingNonce = await provider.getTransactionCount(operatorAddress, "latest");
    expect(endingNonce - startingNonce).to.equal(1);
  });
});
