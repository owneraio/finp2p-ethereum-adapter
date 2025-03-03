import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { generateNonce } from "./utils";
import { v4 as uuidv4 } from "uuid";
import { Wallet } from "ethers";
import { compactSerialize, getFinId, privateKeyToFinId } from "../src/contracts/utils";
import {
  PRIMARY_SALE_TYPES,
  REDEMPTION_TYPES,
  SELLING_TYPES,
  BUYING_TYPES,
  PrimaryType,
  finId,
  term,
  hash,
  sign,
  verify,
  newBuyingMessage,
  newPrimarySaleMessage,
  newRedemptionMessage,
  newSellingMessage,
  newReceiptMessage,
  source,
  destination,
  asset,
  tradeDetails,
  transactionDetails,
  executionContext,
  RECEIPT_PROOF_TYPES
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
    const asset = term(`bank-us:102:${uuidv4()}`, 'finp2p', `${getRandomNumber(1, 100)}`);
    const settlement = term('USD', 'fiat', `${getRandomNumber(1, 100)}`);
    const message = newPrimarySaleMessage(nonce, finId(buyerFinId), finId(issuerFinId), asset, settlement);
    const signature = await sign(chainId, verifyingContract, PRIMARY_SALE_TYPES, message, issuer);
    const signerAddress = await issuer.getAddress();
    const offChainHash = hash(chainId, verifyingContract, PRIMARY_SALE_TYPES, message);
    const onChainHash = await verifier.hashPrimarySale(nonce, buyerFinId, issuerFinId, asset, settlement);
    expect(offChainHash).to.equal(onChainHash);
    expect(verify(chainId, verifyingContract, PRIMARY_SALE_TYPES, message, signerAddress, signature)).to.equal(true);
    expect(await verifier.verifyPrimarySaleSignature(nonce, buyerFinId, issuerFinId, asset, settlement, signerAddress, signature)).to.equal(true);
  });

  it("Secondary sale signature (selling)", async function() {
    const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const buyer = Wallet.createRandom();
    const seller = Wallet.createRandom();
    const nonce = `${generateNonce().toString('hex')}`;
    const buyerFinId = getFinId(buyer);
    const sellerFinId = getFinId(seller);
    const signerAddress = await seller.getAddress();
    const asset = term(`bank-us:102:${uuidv4()}`, 'finp2p', `${getRandomNumber(1, 100)}`);
    const settlement = term('USD', 'fiat', `${getRandomNumber(1, 100)}`);
    const message = newSellingMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
    const signature = await sign(chainId, verifyingContract, SELLING_TYPES, message, seller);
    const offChainHash = hash(chainId, verifyingContract, SELLING_TYPES, message);
    const onChainHash = await verifier.hashSelling(nonce, buyerFinId, sellerFinId, asset, settlement);
    expect(offChainHash).to.equal(onChainHash);
    expect(await verifier.verifyTransferSignature(nonce, buyerFinId, sellerFinId, asset, settlement, signerAddress, PrimaryType.Selling, signature)).to.equal(true);
  });

  it("Secondary sale signature (buying)", async function() {
    const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const buyer = Wallet.createRandom();
    const seller = Wallet.createRandom();
    const nonce = `${generateNonce().toString('hex')}`;
    const buyerFinId = getFinId(buyer);
    const sellerFinId = getFinId(seller);
    const asset = term(`bank-us:102:${uuidv4()}`, 'finp2p', `${getRandomNumber(1, 100)}`);
    const settlement = term( 'USD', 'fiat', `${getRandomNumber(1, 100)}`);
    const signerAddress = await seller.getAddress();
    const message = newBuyingMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
    const signature = await sign(chainId, verifyingContract, BUYING_TYPES, message, seller);
    const offChainHash = hash(chainId, verifyingContract, BUYING_TYPES, message);
    const onChainHash = await verifier.hashBuying(nonce, buyerFinId, sellerFinId, asset, settlement);
    expect(offChainHash).to.equal(onChainHash);
    expect(await verifier.verifyTransferSignature(nonce, buyerFinId, sellerFinId, asset, settlement, signerAddress, PrimaryType.Buying, signature)).to.equal(true);
  });

  it("Redemption signature", async function() {
    const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const seller = Wallet.createRandom();
    const issuer = Wallet.createRandom();
    const nonce = `${generateNonce().toString('hex')}`;
    const sellerFinId = getFinId(seller);
    const issuerFinId = getFinId(issuer);
    const asset = term(`bank-us:102:${uuidv4()}`, 'finp2p', `${getRandomNumber(1, 100)}`);
    const settlement = term( 'USD', 'fiat', `${getRandomNumber(1, 100)}`);
    const message = newRedemptionMessage(nonce, finId(issuerFinId), finId(sellerFinId), asset, settlement);
    const signature = await sign(chainId, verifyingContract, REDEMPTION_TYPES, message, seller);
    const signerAddress = await seller.getAddress();
    const offChainHash = hash(chainId, verifyingContract, REDEMPTION_TYPES, message);
    const onChainHash = await verifier.hashRedemption(nonce, issuerFinId, sellerFinId, asset, settlement);
    expect(offChainHash).to.equal(onChainHash);
    expect(await verifier.verifyTransferSignature(nonce, issuerFinId, sellerFinId, asset, settlement, signerAddress, PrimaryType.Redemption, signature)).to.equal(true);
  });

  it("Receipt proof signature", async function() {
    const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const id = uuidv4();
    const operationType = 'issue';
    const singerWallet = Wallet.createRandom();
    const sourceWallet = Wallet.createRandom();
    const destinationWallet = Wallet.createRandom();
    const sourceFinId = getFinId(sourceWallet);
    const destinationFinId = getFinId(destinationWallet);
    const message = newReceiptMessage(id, operationType,
      source('finId', sourceFinId),
      destination('finId', destinationFinId),
      asset(`bank-us:102:${uuidv4()}`, 'finp2p'),
      '100.00',
      tradeDetails(executionContext('', '')),
      transactionDetails('', id)
    );

    const offChainHash = hash(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message);
    const signature = await sign(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message, singerWallet);
    console.log('Receipt hash', offChainHash);
    console.log('Receipt signature', compactSerialize(signature));
  });


});

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}