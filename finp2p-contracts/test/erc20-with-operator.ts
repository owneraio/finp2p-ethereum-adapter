import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { ERC20WithOperator } from "../typechain-types";

describe("ERC20WithOperator", function() {

  async function deployFixture() {
    const [deployer, operator, alice, bob, mallory] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("ERC20WithOperator");
    const token = (await factory.deploy("Test", "TST", 6, operator.address)) as unknown as ERC20WithOperator;

    // seed some balance for alice: operator holds MINTER_ROLE and mints to alice.
    await token.connect(operator).mint(alice.address, 1000);

    return { token, deployer, operator, alice, bob, mallory };
  }

  describe("burn(uint256)", function() {

    it("burns from the caller when the caller has balance", async () => {
      const { token, alice } = await loadFixture(deployFixture);
      await token.connect(alice).burn(400);
      expect(await token.balanceOf(alice.address)).to.equal(600);
      expect(await token.totalSupply()).to.equal(600);
    });

    it("reverts when the caller has insufficient balance", async () => {
      const { token, bob } = await loadFixture(deployFixture);
      await expect(token.connect(bob).burn(1)).to.be.revertedWith("ERC20: burn amount exceeds balance");
    });

    it("emits Transfer to the zero address", async () => {
      const { token, alice } = await loadFixture(deployFixture);
      await expect(token.connect(alice).burn(100))
        .to.emit(token, "Transfer")
        .withArgs(alice.address, ethers.ZeroAddress, 100);
    });
  });

  describe("burnFrom(address, uint256)", function() {

    it("reverts when a non-operator caller has no allowance", async () => {
      const { token, alice, mallory } = await loadFixture(deployFixture);
      await expect(token.connect(mallory).burnFrom(alice.address, 1))
        .to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("succeeds when a non-operator caller has sufficient allowance, and consumes the allowance", async () => {
      const { token, alice, bob } = await loadFixture(deployFixture);
      await token.connect(alice).approve(bob.address, 300);

      await token.connect(bob).burnFrom(alice.address, 200);

      expect(await token.balanceOf(alice.address)).to.equal(800);
      expect(await token.totalSupply()).to.equal(800);
      expect(await token.allowance(alice.address, bob.address)).to.equal(100);
    });

    it("reverts when non-operator allowance is insufficient", async () => {
      const { token, alice, bob } = await loadFixture(deployFixture);
      await token.connect(alice).approve(bob.address, 100);
      await expect(token.connect(bob).burnFrom(alice.address, 200))
        .to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("bypasses allowance when the caller holds MINTER_ROLE (operator burn on redeem)", async () => {
      const { token, operator, alice } = await loadFixture(deployFixture);
      expect(await token.allowance(alice.address, operator.address)).to.equal(0);

      await token.connect(operator).burnFrom(alice.address, 500);

      expect(await token.balanceOf(alice.address)).to.equal(500);
      expect(await token.totalSupply()).to.equal(500);
      // no allowance was set, and none was consumed
      expect(await token.allowance(alice.address, operator.address)).to.equal(0);
    });

    it("still reverts when the target has insufficient balance, even for MINTER_ROLE caller", async () => {
      const { token, operator, alice } = await loadFixture(deployFixture);
      await expect(token.connect(operator).burnFrom(alice.address, 5000))
        .to.be.revertedWith("ERC20: burn amount exceeds balance");
    });

    it("reverts on burnFrom(address(0), _)", async () => {
      const { token, operator } = await loadFixture(deployFixture);
      await expect(token.connect(operator).burnFrom(ethers.ZeroAddress, 1))
        .to.be.revertedWith("ERC20: burn from the zero address");
    });

    it("emits Transfer(account, address(0), value)", async () => {
      const { token, operator, alice } = await loadFixture(deployFixture);
      await expect(token.connect(operator).burnFrom(alice.address, 50))
        .to.emit(token, "Transfer")
        .withArgs(alice.address, ethers.ZeroAddress, 50);
    });
  });

  describe("mint(address, uint256)", function() {

    it("reverts when caller lacks MINTER_ROLE", async () => {
      const { token, alice, bob } = await loadFixture(deployFixture);
      await expect(token.connect(alice).mint(bob.address, 1))
        .to.be.revertedWith("ERC20WithOperator: must have minter role to mint");
    });

    it("succeeds for MINTER_ROLE holder", async () => {
      const { token, operator, bob } = await loadFixture(deployFixture);
      await token.connect(operator).mint(bob.address, 42);
      expect(await token.balanceOf(bob.address)).to.equal(42);
    });
  });

  describe("transferFrom operator bypass (regression)", function() {

    it("bypasses allowance when spender has OPERATOR_ROLE", async () => {
      const { token, operator, alice, bob } = await loadFixture(deployFixture);
      // operator was granted OPERATOR_ROLE at deploy — no explicit approve needed
      await token.connect(operator).transferFrom(alice.address, bob.address, 100);
      expect(await token.balanceOf(alice.address)).to.equal(900);
      expect(await token.balanceOf(bob.address)).to.equal(100);
    });

    it("requires allowance for non-operator spenders", async () => {
      const { token, alice, bob, mallory } = await loadFixture(deployFixture);
      await expect(token.connect(mallory).transferFrom(alice.address, bob.address, 1))
        .to.be.revertedWith("ERC20: insufficient allowance");
    });
  });
});
