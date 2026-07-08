import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { ERC20 } from "../typechain-types";

describe("ERC20 (pure OpenZeppelin)", function() {

  async function deployFixture() {
    const [deployer, operator, alice, bob, mallory] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("contracts/token/ERC20/ERC20.sol:ERC20");
    const token = (await factory.deploy("Test", "TST", 6, operator.address)) as unknown as ERC20;

    // seed alice with balance so we have something to burn/transfer.
    await token.connect(operator).mint(alice.address, 1000);

    return { token, deployer, operator, alice, bob, mallory };
  }

  describe("metadata", function() {

    it("exposes configured name / symbol / decimals", async () => {
      const { token } = await loadFixture(deployFixture);
      expect(await token.name()).to.equal("Test");
      expect(await token.symbol()).to.equal("TST");
      expect(await token.decimals()).to.equal(6);
    });
  });

  describe("burn(uint256)", function() {

    it("burns from the caller when the caller has balance", async () => {
      const { token, alice } = await loadFixture(deployFixture);
      await token.connect(alice).burn(400);
      expect(await token.balanceOf(alice.address)).to.equal(600);
      expect(await token.totalSupply()).to.equal(600);
    });

    it("reverts when the caller has insufficient balance", async () => {
      const { token, bob } = await loadFixture(deployFixture);
      await expect(token.connect(bob).burn(1)).to.be.reverted;
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
        .to.be.reverted;
    });

    it("succeeds with allowance and consumes it", async () => {
      const { token, alice, bob } = await loadFixture(deployFixture);
      await token.connect(alice).approve(bob.address, 300);

      await token.connect(bob).burnFrom(alice.address, 200);

      expect(await token.balanceOf(alice.address)).to.equal(800);
      expect(await token.totalSupply()).to.equal(800);
      expect(await token.allowance(alice.address, bob.address)).to.equal(100);
    });

    it("reverts when allowance is insufficient", async () => {
      const { token, alice, bob } = await loadFixture(deployFixture);
      await token.connect(alice).approve(bob.address, 100);
      await expect(token.connect(bob).burnFrom(alice.address, 200))
        .to.be.reverted;
    });

    it("does NOT bypass allowance for MINTER_ROLE (differs from ERC20WithOperator)", async () => {
      const { token, operator, alice } = await loadFixture(deployFixture);
      expect(await token.hasRole(await token.MINTER_ROLE(), operator.address)).to.equal(true);
      expect(await token.allowance(alice.address, operator.address)).to.equal(0);

      await expect(token.connect(operator).burnFrom(alice.address, 1))
        .to.be.reverted;
    });

    it("emits Transfer(account, address(0), value)", async () => {
      const { token, alice, bob } = await loadFixture(deployFixture);
      await token.connect(alice).approve(bob.address, 50);
      await expect(token.connect(bob).burnFrom(alice.address, 50))
        .to.emit(token, "Transfer")
        .withArgs(alice.address, ethers.ZeroAddress, 50);
    });
  });

  describe("transferFrom(from, to, amount)", function() {

    it("does NOT bypass allowance for OPERATOR_ROLE (differs from ERC20WithOperator)", async () => {
      const { token, operator, alice, bob } = await loadFixture(deployFixture);
      expect(await token.hasRole(await token.OPERATOR_ROLE(), operator.address)).to.equal(true);
      expect(await token.allowance(alice.address, operator.address)).to.equal(0);

      await expect(token.connect(operator).transferFrom(alice.address, bob.address, 1))
        .to.be.reverted;
    });

    it("succeeds with a standard allowance and consumes it", async () => {
      const { token, alice, bob, mallory } = await loadFixture(deployFixture);
      await token.connect(alice).approve(mallory.address, 300);
      await token.connect(mallory).transferFrom(alice.address, bob.address, 200);

      expect(await token.balanceOf(alice.address)).to.equal(800);
      expect(await token.balanceOf(bob.address)).to.equal(200);
      expect(await token.allowance(alice.address, mallory.address)).to.equal(100);
    });
  });

  describe("mint(address, uint256)", function() {

    it("reverts when caller lacks MINTER_ROLE", async () => {
      const { token, alice, bob } = await loadFixture(deployFixture);
      await expect(token.connect(alice).mint(bob.address, 1))
        .to.be.revertedWith("ERC20: must have minter role to mint");
    });

    it("succeeds for MINTER_ROLE holder", async () => {
      const { token, operator, bob } = await loadFixture(deployFixture);
      await token.connect(operator).mint(bob.address, 42);
      expect(await token.balanceOf(bob.address)).to.equal(42);
    });
  });

  describe("role administration", function() {

    it("deployer holds DEFAULT_ADMIN_ROLE; operator holds MINTER + OPERATOR", async () => {
      const { token, deployer, operator } = await loadFixture(deployFixture);
      expect(await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), deployer.address)).to.equal(true);
      expect(await token.hasRole(await token.MINTER_ROLE(), operator.address)).to.equal(true);
      expect(await token.hasRole(await token.OPERATOR_ROLE(), operator.address)).to.equal(true);
    });

    it("grantMinterTo requires admin", async () => {
      const { token, alice, bob } = await loadFixture(deployFixture);
      await expect(token.connect(alice).grantMinterTo(bob.address))
        .to.be.revertedWith("ERC20: must have admin role to grant minter");
    });

    it("grantMinterTo succeeds for admin and the granted account can mint", async () => {
      const { token, deployer, bob, alice } = await loadFixture(deployFixture);
      await token.connect(deployer).grantMinterTo(bob.address);
      await token.connect(bob).mint(alice.address, 10);
      expect(await token.balanceOf(alice.address)).to.equal(1010);
    });

    it("grantOperatorTo requires admin", async () => {
      const { token, alice, bob } = await loadFixture(deployFixture);
      await expect(token.connect(alice).grantOperatorTo(bob.address))
        .to.be.revertedWith("ERC20: must have admin role to grant operator");
    });

    it("grantOperatorTo succeeds for admin but confers no transferFrom bypass", async () => {
      const { token, deployer, mallory, alice, bob } = await loadFixture(deployFixture);
      await token.connect(deployer).grantOperatorTo(mallory.address);
      // holds OPERATOR_ROLE now, but transferFrom still needs allowance
      await expect(token.connect(mallory).transferFrom(alice.address, bob.address, 1))
        .to.be.reverted;
    });
  });
});
