import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { NonceManager, Wallet, hexlify, randomBytes } from "ethers";
import { v4 as uuid } from "uuid";
import { FinP2PContract } from "../src/finp2p";
import { Logger } from "../src/adapter-types";

/**
 * Hardhat-network test: multiple operator wallets, each independently
 * granted ASSET_MANAGER, can each successfully send a state-changing tx
 * through their own `FinP2PContract` / `safeExecuteTransaction`.
 *
 * Exercises the role system + multiple independent NonceManagers
 * (one per operator key) + the wrapper end-to-end. Each operator
 * adds a unique credential and we verify the on-chain state after.
 */

const HARDHAT_DEFAULT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const silentLogger: Logger = {
  info: () => {},
  debug: () => {},
  warning: () => {},
  error: () => {},
} as unknown as Logger;

describe("multiple operators (hardhat)", function () {

  for (const N of [2, 3]) {
    it(`${N} operators each transact independently after being granted ASSET_MANAGER`, async () => {
      const provider = ethers.provider;
      const adminWallet = new Wallet(HARDHAT_DEFAULT_KEY).connect(provider);

      // Deploy FINP2POperator. Admin = hardhat account 0 = HARDHAT_DEFAULT_KEY.
      const factory = await ethers.getContractFactory("FINP2POperator");
      const finP2P = await factory.deploy(adminWallet.address);
      const finP2PAddress = await finP2P.getAddress();

      const adminManager = new FinP2PContract(
        provider,
        new NonceManager(adminWallet).connect(provider),
        finP2PAddress,
        silentLogger,
      );

      // Generate N operator wallets, fund each with 1 ETH so they can pay gas.
      const operators: Wallet[] = [];
      for (let i = 0; i < N; i++) {
        const opWallet = Wallet.createRandom().connect(provider);
        const tx = await adminWallet.sendTransaction({ to: opWallet.address, value: ethers.parseEther("1") });
        await tx.wait();
        operators.push(opWallet);
      }

      // Admin grants ASSET_MANAGER role to each operator (one tx per operator).
      for (const op of operators) {
        await adminManager.grantAssetManagerRole(finP2PAddress, op.address);
      }

      // Each operator independently adds a unique credential.
      const grants: Array<{ finId: string; credAddress: string; operatorAddr: string }> = [];
      for (const op of operators) {
        const opManager = new FinP2PContract(
          provider,
          new NonceManager(op).connect(provider),
          finP2PAddress,
          silentLogger,
        );
        const finId = `bank-us:101:${uuid()}`;
        const credAddress = hexlify(randomBytes(20));
        await opManager.addCredential(finId, credAddress);
        grants.push({ finId, credAddress, operatorAddr: op.address });
      }

      // Verify each credential landed on-chain.
      for (const { finId, credAddress } of grants) {
        const stored = await adminManager.getCredentialAddress(finId);
        expect(stored.toLowerCase()).to.equal(credAddress.toLowerCase());
      }

      // Each operator's own nonce moved by exactly 1 (one addCredential each).
      for (const op of operators) {
        const opNonce = await provider.getTransactionCount(op.address, "latest");
        expect(opNonce, `operator ${op.address} should have submitted exactly 1 tx`).to.equal(1);
      }
    });
  }
});
