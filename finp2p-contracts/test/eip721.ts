import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import {
  createCrypto,
  EIP721IssuanceMessage,
  generateNonce,
  signEIP721Issuance,
  termHash,
  verifyEIP721Issuance
} from "./utils";
import { v4 as uuidv4 } from "uuid";

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

    const nonce = `0x${generateNonce().toString("hex")}`;
    const { public: buyerPublic } = createCrypto();
    const buyer = `${buyerPublic.toString("hex")}`;
    const { public: issuerPublic } = createCrypto();
    const issuer = `${issuerPublic.toString("hex")}`;
    const amount = getRandomNumber(1, 100);
    const assetId = `bank-us:102:${uuidv4()}`;
    const settlementAsset = "USD";
    const settlementAmount = getRandomNumber(1, 100);

    const message = {
      nonce,
      buyer: { key: buyer },
      issuer: { key: issuer },
      asset: {
        assetId,
        assetType: "finP2P",
        amount
      },
      settlement: {
        assetId: settlementAsset,
        assetType: "fiat",
        amount: settlementAmount
      }
    } as EIP721IssuanceMessage;

    const signature = await signEIP721Issuance(chainId, verifyingContract, message, signer);
    const settlementHash = termHash(settlementAsset, "fiat", settlementAmount);

    const signerAddress = await signer.getAddress();
    expect(verifyEIP721Issuance(chainId, verifyingContract, message, signerAddress, signature)).to.equal(true);

    const verified = await verifier.verifyIssueSignature(nonce, buyer, issuer, assetId, amount, settlementHash,
      signerAddress, signature);
    expect(verified).to.equal(true);
  });


});

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}