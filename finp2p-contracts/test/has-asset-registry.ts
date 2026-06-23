import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { FinP2PContract, isFunctionMissingError } from "../src/finp2p";
import { Logger } from "../src/adapter-types";

const silentLogger: Logger = {
  info: () => {},
  warning: () => {},
  error: () => {},
  debug: () => {},
};

describe("FinP2PContract.hasAssetRegistry", function () {
  async function deployBasicOperator() {
    const [admin] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("FINP2POperator");
    const contract = await factory.deploy(admin.address);
    await contract.waitForDeployment();
    return { address: await contract.getAddress(), signer: admin };
  }

  async function deployWithRegistry() {
    const [admin] = await ethers.getSigners();
    const registryFactory = await ethers.getContractFactory("AssetRegistry");
    const registry = await registryFactory.deploy();
    await registry.waitForDeployment();

    const factory = await ethers.getContractFactory("FINP2POperatorWithRegistry");
    const contract = await factory.deploy(admin.address, await registry.getAddress());
    await contract.waitForDeployment();
    return { address: await contract.getAddress(), signer: admin };
  }

  it("returns false for the basic FINP2POperator", async () => {
    const { address, signer } = await loadFixture(deployBasicOperator);
    const wrapper = new FinP2PContract(ethers.provider, signer, address, silentLogger);
    expect(await wrapper.hasAssetRegistry()).to.equal(false);
  });

  it("returns true for FINP2POperatorWithRegistry", async () => {
    const { address, signer } = await loadFixture(deployWithRegistry);
    const wrapper = new FinP2PContract(ethers.provider, signer, address, silentLogger);
    expect(await wrapper.hasAssetRegistry()).to.equal(true);
  });

  it("FinP2PContract.create() detects 'basic' variant", async () => {
    const { address, signer } = await loadFixture(deployBasicOperator);
    const wrapper = await FinP2PContract.create(ethers.provider, signer, address, silentLogger);
    expect(wrapper.variant).to.equal("basic");
  });

  it("FinP2PContract.create() detects 'with-registry' variant", async () => {
    const { address, signer } = await loadFixture(deployWithRegistry);
    const wrapper = await FinP2PContract.create(ethers.provider, signer, address, silentLogger);
    expect(wrapper.variant).to.equal("with-registry");
  });

  it("associateAsset on with-registry requires an assetStandard arg", async () => {
    const { address, signer } = await loadFixture(deployWithRegistry);
    const wrapper = await FinP2PContract.create(ethers.provider, signer, address, silentLogger);
    await expect(wrapper.associateAsset("asset-1", "0x0000000000000000000000000000000000000001")).to.be.rejectedWith(
      /requires a bytes32 assetStandard/,
    );
  });
});

describe("isFunctionMissingError", function () {
  it("returns true for ethers v6 CALL_EXCEPTION with empty data", () => {
    expect(isFunctionMissingError({ code: "CALL_EXCEPTION", data: "0x" })).to.equal(true);
    expect(isFunctionMissingError({ code: "CALL_EXCEPTION" })).to.equal(true);
  });

  it("returns true for Hardhat-EDR's function-selector message", () => {
    expect(isFunctionMissingError(new Error("Transaction reverted: function selector was not recognized and there's no fallback function"))).to.equal(true);
  });

  it("returns false for transport failures (NETWORK_ERROR, TIMEOUT, unauthenticated)", () => {
    expect(isFunctionMissingError({ code: "NETWORK_ERROR", message: "could not connect" })).to.equal(false);
    expect(isFunctionMissingError({ code: "TIMEOUT" })).to.equal(false);
    expect(isFunctionMissingError(new Error("401 Unauthorized"))).to.equal(false);
  });

  it("returns false for CALL_EXCEPTION with non-empty revert data", () => {
    expect(isFunctionMissingError({ code: "CALL_EXCEPTION", data: "0x08c379a0..." })).to.equal(false);
  });

  it("returns false for nullish input", () => {
    expect(isFunctionMissingError(undefined)).to.equal(false);
    expect(isFunctionMissingError(null)).to.equal(false);
    expect(isFunctionMissingError("string error")).to.equal(false);
  });
});
