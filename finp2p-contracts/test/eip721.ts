import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";


describe("EIP-721 signing test", function() {
  async function deployFinP2PTypedVerifier() {
    const deployer = await ethers.getContractFactory("FinP2PTypedVerifier");
    const contract = await deployer.deploy();
    const address = await contract.getAddress();
    return { contract, address };
  }


  it("sign", async function() {
    const [signer] = await ethers.getSigners();
    const { contract: verifier } = await loadFixture(deployFinP2PTypedVerifier);


    const { name, version, chainId, verifyingContract } = await verifier.eip712Domain();
    console.log(`domain: ${name}, ${version}, ${chainId}, ${verifyingContract}`);

    const domain = {
      name, version, chainId, verifyingContract
    };

    const types = {
      finId: [{
        name: "key", type: "string"
      }],
      PrimarySale: [
        { name: "nonce", type: "bytes" },
        { name: "buyer", type: "finId" },
        { name: "issuer", type: "string" },
        { name: "amount", type: "string" },
        { name: "assetId", type: "string" },
        { name: "settlementAsset", type: "string" },
        { name: "settlementAmount", type: "string" }
      ]
    };

    const nonce = "0x712a8920ef2c1c99f8245c7f35b86c80fb6a6ebd4c12bf2f";
    const buyer = "020e49498eedca38a0b7f74ae1818b21125cb6abfda83de3d31f188f8311522b12";
    const issuer = "020e49498eedca38a0b7f74ae1818b21125cb6abfda83de3d31f188f8311522b12";
    const amount = "10";
    const assetId = "bank-us:102:92c46f2c-43e1-43a5-b8f7-8deb3c23eab5";
    const settlementAsset = "USD";
    const settlementAmount = "30";

    const message = {
      nonce,
      // buyer,
      buyer: { key: buyer },
      issuer,
      // issuer: { key: issuer },
      amount,
      assetId,
      settlementAsset,
      settlementAmount
    };

    const signature = await signer.signTypedData(domain, types, message);
    console.log(`signature: ${signature}`);

    const signerAddress = await signer.getAddress();
    expect(ethers.verifyTypedData(domain, types, message, signature)).to.equal(signerAddress);

    // const verified = await verifier.verifyTestSignature(nonce, buyer, issuer, signerAddress, signature);
    const verified = await verifier.verifyIssueSignature(nonce, buyer, issuer, amount, assetId, settlementAsset, settlementAmount, signerAddress, signature);
    expect(verified).to.equal(true);
  });


});
