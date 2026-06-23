import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { FinP2PContract } from "../src/finp2p";
import winston from "winston";

const silentLogger = winston.createLogger({
  level: "error",
  transports: [new winston.transports.Console({ silent: true })],
});

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
});
