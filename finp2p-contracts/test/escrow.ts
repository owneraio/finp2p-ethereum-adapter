import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuid } from "uuid";
import { ERC20WithOperator, FinP2PEscrow } from "../typechain-types";

describe("FinP2PEscrow", function() {

  async function deployEscrowFixture() {
    const [admin, investor, buyer, stranger] = await ethers.getSigners();

    const escrowDeployer = await ethers.getContractFactory("FinP2PEscrow");
    const escrow: FinP2PEscrow = await escrowDeployer.deploy(admin);
    const escrowAddress = await escrow.getAddress();

    const tokenDeployer = await ethers.getContractFactory("ERC20WithOperator");
    const token: ERC20WithOperator = await tokenDeployer.deploy("Test token", "TST", 2, admin);
    const tokenAddress = await token.getAddress();
    // let the escrow pull funds without per-transfer allowances (operator mode)
    await token.grantOperatorTo(escrowAddress);

    await token.mint(investor, 1000);

    return { admin, investor, buyer, stranger, escrow, escrowAddress, token, tokenAddress };
  }

  describe("deposit", () => {

    it("escrow operator can deposit on behalf of a source", async () => {
      const { admin, investor, buyer, escrow, escrowAddress, token, tokenAddress } = await loadFixture(deployEscrowFixture);
      const opId = uuid();

      await expect(escrow.connect(admin).deposit(opId, tokenAddress, investor, buyer, 100))
        .to.emit(escrow, "HoldCreated")
        .withArgs(opId, tokenAddress, await investor.getAddress(), await buyer.getAddress(), 100);

      expect(await token.balanceOf(investor)).to.equal(900);
      expect(await token.balanceOf(escrowAddress)).to.equal(100);

      const hold = await escrow.getHold(opId);
      expect(hold.amount).to.equal(100);
      expect(hold.status).to.equal(1); // HELD
      expect(await escrow.hasHold(opId)).to.equal(true);
    });

    it("source can deposit directly after approving the escrow (direct mode)", async () => {
      const { investor, buyer, escrow, escrowAddress, token, tokenAddress } = await loadFixture(deployEscrowFixture);
      const opId = uuid();

      await token.connect(investor).approve(escrowAddress, 100);
      await escrow.connect(investor).deposit(opId, tokenAddress, investor, buyer, 100);

      expect(await token.balanceOf(escrowAddress)).to.equal(100);
    });

    it("rejects deposit from a caller that is neither source nor operator", async () => {
      const { investor, buyer, stranger, escrow, tokenAddress } = await loadFixture(deployEscrowFixture);
      await expect(escrow.connect(stranger).deposit(uuid(), tokenAddress, investor, buyer, 100))
        .to.be.revertedWith("FinP2PEscrow: caller is not the source or an escrow operator");
    });

    it("rejects a second deposit under the same operationId", async () => {
      const { admin, investor, buyer, escrow, tokenAddress } = await loadFixture(deployEscrowFixture);
      const opId = uuid();
      await escrow.connect(admin).deposit(opId, tokenAddress, investor, buyer, 100);
      await expect(escrow.connect(admin).deposit(opId, tokenAddress, investor, buyer, 50))
        .to.be.revertedWith("FinP2PEscrow: hold already exists for operationId");
    });

    it("rejects deposit exceeding the source balance", async () => {
      const { admin, investor, buyer, escrow, tokenAddress } = await loadFixture(deployEscrowFixture);
      await expect(escrow.connect(admin).deposit(uuid(), tokenAddress, investor, buyer, 5000))
        .to.be.reverted;
    });
  });

  describe("release", () => {

    it("releases to the hold destination", async () => {
      const { admin, investor, buyer, escrow, escrowAddress, token, tokenAddress } = await loadFixture(deployEscrowFixture);
      const opId = uuid();
      await escrow.connect(admin).deposit(opId, tokenAddress, investor, buyer, 100);

      await expect(escrow.connect(admin).release(opId, buyer))
        .to.emit(escrow, "HoldReleased")
        .withArgs(opId, await buyer.getAddress(), 100);

      expect(await token.balanceOf(buyer)).to.equal(100);
      expect(await token.balanceOf(escrowAddress)).to.equal(0);
      expect(await escrow.hasHold(opId)).to.equal(false);
    });

    it("rejects release to a destination different from the held one", async () => {
      const { admin, investor, buyer, stranger, escrow, tokenAddress } = await loadFixture(deployEscrowFixture);
      const opId = uuid();
      await escrow.connect(admin).deposit(opId, tokenAddress, investor, buyer, 100);
      await expect(escrow.connect(admin).release(opId, stranger))
        .to.be.revertedWith("FinP2PEscrow: release destination differs from the held one");
    });

    it("refuses to release a hold without a fixed destination (burn or roll back instead)", async () => {
      const { admin, investor, stranger, escrow, token, tokenAddress } = await loadFixture(deployEscrowFixture);
      const opId = uuid();
      await escrow.connect(admin).deposit(opId, tokenAddress, investor, ethers.ZeroAddress, 100);
      await expect(escrow.connect(admin).release(opId, stranger))
        .to.be.revertedWith("FinP2PEscrow: hold has no destination; burn or roll back instead");
      // ...but it can still be rolled back to the source
      await escrow.connect(admin).rollback(opId);
      expect(await token.balanceOf(investor)).to.equal(1000);
    });

    it("rejects double release", async () => {
      const { admin, investor, buyer, escrow, tokenAddress } = await loadFixture(deployEscrowFixture);
      const opId = uuid();
      await escrow.connect(admin).deposit(opId, tokenAddress, investor, buyer, 100);
      await escrow.connect(admin).release(opId, buyer);
      await expect(escrow.connect(admin).release(opId, buyer))
        .to.be.revertedWith("FinP2PEscrow: hold is not active");
    });

    it("rejects release of an unknown hold", async () => {
      const { admin, buyer, escrow } = await loadFixture(deployEscrowFixture);
      await expect(escrow.connect(admin).release(uuid(), buyer))
        .to.be.revertedWith("FinP2PEscrow: hold not found");
    });

    it("rejects release from a non-operator", async () => {
      const { admin, investor, buyer, stranger, escrow, tokenAddress } = await loadFixture(deployEscrowFixture);
      const opId = uuid();
      await escrow.connect(admin).deposit(opId, tokenAddress, investor, buyer, 100);
      await expect(escrow.connect(stranger).release(opId, buyer)).to.be.reverted;
    });
  });

  describe("rollback", () => {

    it("returns the held amount to the source", async () => {
      const { admin, investor, buyer, escrow, escrowAddress, token, tokenAddress } = await loadFixture(deployEscrowFixture);
      const opId = uuid();
      await escrow.connect(admin).deposit(opId, tokenAddress, investor, buyer, 100);

      await expect(escrow.connect(admin).rollback(opId))
        .to.emit(escrow, "HoldRolledBack")
        .withArgs(opId, 100);

      expect(await token.balanceOf(investor)).to.equal(1000);
      expect(await token.balanceOf(escrowAddress)).to.equal(0);
    });

    it("rejects rollback after release", async () => {
      const { admin, investor, buyer, escrow, tokenAddress } = await loadFixture(deployEscrowFixture);
      const opId = uuid();
      await escrow.connect(admin).deposit(opId, tokenAddress, investor, buyer, 100);
      await escrow.connect(admin).release(opId, buyer);
      await expect(escrow.connect(admin).rollback(opId))
        .to.be.revertedWith("FinP2PEscrow: hold is not active");
    });
  });

  describe("releaseAndBurn", () => {

    it("burns the held amount", async () => {
      const { admin, investor, escrow, escrowAddress, token, tokenAddress } = await loadFixture(deployEscrowFixture);
      const opId = uuid();
      await escrow.connect(admin).deposit(opId, tokenAddress, investor, ethers.ZeroAddress, 100);

      const supplyBefore = await token.totalSupply();
      await expect(escrow.connect(admin).releaseAndBurn(opId))
        .to.emit(escrow, "HoldBurned")
        .withArgs(opId, 100);

      expect(await token.totalSupply()).to.equal(supplyBefore - 100n);
      expect(await token.balanceOf(escrowAddress)).to.equal(0);
      expect(await escrow.hasHold(opId)).to.equal(false);
    });
  });
});
