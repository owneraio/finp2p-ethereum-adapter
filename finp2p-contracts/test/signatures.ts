import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import {
  buildTransferHash, generateNonce, sign
} from "./utils";
import { v4 as uuidv4 } from "uuid";
import { Wallet } from "ethers";
import { getFinId } from "../src/contracts/utils";
import { HashType } from "../src/contracts/model";
import {
  EIP712_PRIMARY_SALE_TYPES,
  EIP712_REDEMPTION_TYPES, EIP712_SELLING_TYPES, EIP712PrimaryType,
  eip712Sign,
  eip712Verify,
  newEIP712BuyingMessage,
  newEIP712PrimarySaleMessage,
  newRedemptionMessage
} from "../src/contracts/eip712";


describe("Signing test", function() {
  async function deployFinP2PSignatureVerifier() {
    const deployer = await ethers.getContractFactory("FinP2PSignatureVerifier");
    const contract = await deployer.deploy();
    const address = await contract.getAddress();
    return { contract, address };
  }

  it("Primary sale signatures", async function() {
    const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const buyer = Wallet.createRandom();
    const issuer = Wallet.createRandom();

    const nonce = `${generateNonce().toString('hex')}`;
    const buyerFinId = getFinId(buyer);
    const issuerFinId = getFinId(issuer);
    const amount = getRandomNumber(1, 100);
    const assetId = `bank-us:102:${uuidv4()}`;
    const settlementAsset = 'USD';
    const settlementAmount = getRandomNumber(1, 100);

    const message = newEIP712PrimarySaleMessage(nonce, buyerFinId, issuerFinId, assetId, 'finp2p', `${amount}`, settlementAsset, 'fiat', `${settlementAmount}`);
    const signature = await eip712Sign(chainId, verifyingContract, EIP712_PRIMARY_SALE_TYPES, message, issuer);
    const signerAddress = await issuer.getAddress();
    expect(eip712Verify(chainId, verifyingContract, EIP712_PRIMARY_SALE_TYPES, message, signerAddress, signature)).to.equal(true);
    expect(await verifier.verifyPrimarySaleSignature(nonce, buyerFinId, issuerFinId, assetId, `${amount}`,
      settlementAsset, `${settlementAmount}`, signerAddress, HashType.EIP712, signature)).to.equal(true);
  });

  it.skip("HashList: Secondary sale signature", async function() {
    const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const buyer = Wallet.createRandom();
    const seller = Wallet.createRandom();

    const nonce = `${generateNonce().toString('hex')}`;
    const buyerFinId = getFinId(buyer);
    const sellerFinId = getFinId(seller);
    const amount = getRandomNumber(1, 100);
    const assetId = `bank-us:102:${uuidv4()}`;
    const settlementAsset = 'USD';
    const settlementAmount = getRandomNumber(1, 100);
    const signerAddress = await seller.getAddress();

    const hlSignature = sign(seller.privateKey, buildTransferHash(nonce, sellerFinId, buyerFinId, assetId, 'finp2p', `${amount}`, settlementAsset, 'fiat', `${settlementAmount}`));

    expect(await verifier.verifyTransferSignature(nonce, buyerFinId, sellerFinId, assetId, `${amount}`, settlementAsset,
      `${settlementAmount}`, signerAddress, HashType.HashList, EIP712PrimaryType.Selling, hlSignature)).to.equal(true);

    const eip712signature = await eip712Sign(chainId, verifyingContract, EIP712_SELLING_TYPES,
      newEIP712BuyingMessage(nonce, sellerFinId, buyerFinId, assetId, 'finp2p', `${amount}`, settlementAsset, 'fiat', `${settlementAmount}`), seller);

    expect(await verifier.verifyTransferSignature(nonce, buyerFinId, sellerFinId, assetId, `${amount}`, settlementAsset,
      `${settlementAmount}`, signerAddress, HashType.EIP712, EIP712PrimaryType.Selling, eip712signature)).to.equal(true);
  });

  it("Redemption signature", async function() {
    const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const owner = Wallet.createRandom();
    const buyer = Wallet.createRandom();

    const nonce = `${generateNonce().toString('hex')}`;
    const ownerFinId = getFinId(owner);
    const buyerFinId = getFinId(buyer);
    const amount = getRandomNumber(1, 100);
    const assetId = `bank-us:102:${uuidv4()}`;
    const settlementAsset = 'USD';
    const settlementAmount = getRandomNumber(1, 100);

    const message = newRedemptionMessage(nonce, ownerFinId, buyerFinId, assetId, "finp2p", `${amount}`, settlementAsset, "fiat", `${settlementAmount}`);

    const signature = await eip712Sign(chainId, verifyingContract, EIP712_REDEMPTION_TYPES, message, owner);
    const signerAddress = await owner.getAddress();
    expect(eip712Verify(chainId, verifyingContract, EIP712_REDEMPTION_TYPES, message, signerAddress, signature)).to.equal(true);
    expect(await verifier.verifyRedemptionSignature(nonce, ownerFinId, buyerFinId, assetId, `${amount}`,
      settlementAsset, `${settlementAmount}`, signerAddress, HashType.EIP712, signature)).to.equal(true);
  });

});

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}