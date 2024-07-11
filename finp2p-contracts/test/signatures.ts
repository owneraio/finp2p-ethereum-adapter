import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import {
  createCrypto,
  generateNonce
} from "./utils";
import {
  EIP721_ISSUANCE_TYPES, EIP721_REDEEM_TYPES, EIP721_TRANSFER_TYPES,
  EIP721IssuanceMessage, EIP721RedeemMessage, EIP721TransferMessage,
  signMessage, verifyMessage
} from "../src/contracts/eip721";
import { v4 as uuidv4 } from "uuid";

describe("Signing test", function() {
  async function deployFinP2PTypedVerifier() {
    const deployer = await ethers.getContractFactory("FinP2PTypedVerifier");
    const contract = await deployer.deploy();
    const address = await contract.getAddress();
    return { contract, address };
  }

  it("primary sale signatures", async function() {
    const [signer] = await ethers.getSigners();
    const { contract: verifier } = await loadFixture(deployFinP2PTypedVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const { public: buyerPublic } = createCrypto();
    const { public: issuerPublic } = createCrypto();

    const nonce = `0x${generateNonce().toString("hex")}`;
    const buyer = `${buyerPublic.toString("hex")}`;
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
        assetType: "finp2p",
        amount: amount
      },
      settlement: {
        assetId: settlementAsset,
        assetType: "fiat",
        amount: settlementAmount
      }
    } as EIP721IssuanceMessage;

    const signature = await signMessage(chainId, verifyingContract, EIP721_ISSUANCE_TYPES, message, signer);
    const signerAddress = await signer.getAddress();
    expect(verifyMessage(chainId, verifyingContract, EIP721_ISSUANCE_TYPES, message, signerAddress, signature)).to.equal(true);
    expect(await verifier.verifyPrimarySaleSignature(nonce, buyer, issuer, assetId, amount, settlementAsset, settlementAmount, signerAddress, signature)).to.equal(true);
  });

  it("secondary sale signature", async function() {
    const [signer] = await ethers.getSigners();
    const { contract: verifier } = await loadFixture(deployFinP2PTypedVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const { public: buyerPublic } = createCrypto();
    const { public: issuerPublic } = createCrypto();

    const nonce = `0x${generateNonce().toString("hex")}`;
    const buyer = `${buyerPublic.toString("hex")}`;
    const seller = `${issuerPublic.toString("hex")}`;
    const amount = getRandomNumber(1, 100);
    const assetId = `bank-us:102:${uuidv4()}`;
    const settlementAsset = "USD";
    const settlementAmount = getRandomNumber(1, 100);

    const message = {
      nonce,
      seller: { key: seller },
      buyer: { key: buyer },
      asset: {
        assetId,
        assetType: "finp2p",
        amount: amount,
      },
      settlement: {
        assetId: settlementAsset,
        assetType: "fiat",
        amount: settlementAmount
      }
    } as EIP721TransferMessage;

    const signature = await signMessage(chainId, verifyingContract, EIP721_TRANSFER_TYPES, message, signer);
    const signerAddress = await signer.getAddress();
    expect(verifyMessage(chainId, verifyingContract, EIP721_TRANSFER_TYPES, message, signerAddress, signature)).to.equal(true);
    expect(await verifier.verifySecondarySaleSignature(nonce, seller, buyer, assetId, amount, settlementAsset,
      settlementAmount, signerAddress, signature)).to.equal(true);
  });

  it("redemption signature", async function() {
    const [signer] = await ethers.getSigners();
    const { contract: verifier } = await loadFixture(deployFinP2PTypedVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const { public: ownerPublic } = createCrypto();
    const { public: buyerPublic } = createCrypto();

    const nonce = `0x${generateNonce().toString("hex")}`;
    const owner = `${ownerPublic.toString("hex")}`;
    const buyer = `${buyerPublic.toString("hex")}`;
    const amount = getRandomNumber(1, 100);
    const assetId = `bank-us:102:${uuidv4()}`;
    const settlementAsset = "USD";
    const settlementAmount = getRandomNumber(1, 100);

    const message = {
      nonce,
      owner: { key: owner },
      buyer: { key: buyer },
      asset: {
        assetId,
        assetType: "finp2p",
        amount: amount,
      },
      settlement: {
        assetId: settlementAsset,
        assetType: "fiat",
        amount: settlementAmount
      }
    } as EIP721RedeemMessage;

    const signature = await signMessage(chainId, verifyingContract, EIP721_REDEEM_TYPES, message, signer);
    const signerAddress = await signer.getAddress();
    expect(verifyMessage(chainId, verifyingContract, EIP721_REDEEM_TYPES, message, signerAddress, signature)).to.equal(true);
    expect(await verifier.verifyRedemptionSignature(nonce,  owner, buyer, assetId, amount,
      settlementAsset, settlementAmount, signerAddress, signature)).to.equal(true);
  });

});

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}