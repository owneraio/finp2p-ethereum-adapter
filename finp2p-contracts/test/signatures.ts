import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { generateNonce } from "./utils";
import { v4 as uuidv4 } from "uuid";
import { Signer, Wallet } from "ethers";
import { getFinId } from "../src/contracts/utils";
import {
  PrimaryType,
  term,
  hash,
  sign,
  verify,
  newReceiptMessage,
  source,
  destination,
  asset,
  tradeDetails,
  transactionDetails,
  executionContext,
  newInvestmentMessage,
  RECEIPT_PROOF_TYPES, Leg, Term
} from "../src/contracts/eip712";


describe("Signing test", function() {
  async function deployFinP2PSignatureVerifier() {
    const deployer = await ethers.getContractFactory("FinP2PSignatureVerifier");
    const contract = await deployer.deploy();
    const address = await contract.getAddress();
    return { contract, address };
  }

  const buyer = Wallet.createRandom();
  const seller = Wallet.createRandom();

  const testCases: {primaryType: PrimaryType, nonce: string, buyerFinId: string, sellerFinId: string, asset: Term, settlement: Term, signer: Signer}[] = [
      {primaryType: PrimaryType.PrimarySale, nonce: `${generateNonce().toString('hex')}`, buyerFinId: getFinId(buyer), sellerFinId: getFinId(seller), asset: term(`bank-us:102:${uuidv4()}`, 'finp2p', `${getRandomNumber(1, 100)}`), settlement: term('USD', 'fiat', `${getRandomNumber(1, 100)}`), signer: seller},
      {primaryType: PrimaryType.Buying, nonce: `${generateNonce().toString('hex')}`, buyerFinId: getFinId(buyer), sellerFinId: getFinId(seller), asset: term(`bank-us:102:${uuidv4()}`, 'finp2p', `${getRandomNumber(1, 100)}`), settlement: term('USD', 'fiat', `${getRandomNumber(1, 100)}`), signer: seller},
      {primaryType: PrimaryType.Selling, nonce: `${generateNonce().toString('hex')}`, buyerFinId: getFinId(buyer), sellerFinId: getFinId(seller), asset: term(`bank-us:102:${uuidv4()}`, 'finp2p', `${getRandomNumber(1, 100)}`), settlement: term('USD', 'fiat', `${getRandomNumber(1, 100)}`), signer: seller},
      {primaryType: PrimaryType.Redemption, nonce: `${generateNonce().toString('hex')}`, buyerFinId: getFinId(buyer), sellerFinId: getFinId(seller), asset: term(`bank-us:102:${uuidv4()}`, 'finp2p', `${getRandomNumber(1, 100)}`), settlement: term('USD', 'fiat', `${getRandomNumber(1, 100)}`), signer: seller},
      {primaryType: PrimaryType.RequestForTransfer, nonce: `${generateNonce().toString('hex')}`, buyerFinId: getFinId(buyer), sellerFinId: getFinId(seller), asset: term(`bank-us:102:${uuidv4()}`, 'finp2p', `${getRandomNumber(1, 100)}`), settlement: term('USD', 'fiat', `${getRandomNumber(1, 100)}`), signer: seller},
      {primaryType: PrimaryType.PrivateOffer, nonce: `${generateNonce().toString('hex')}`, buyerFinId: getFinId(buyer), sellerFinId: getFinId(seller), asset: term(`bank-us:102:${uuidv4()}`, 'finp2p', `${getRandomNumber(1, 100)}`), settlement: term('USD', 'fiat', `${getRandomNumber(1, 100)}`), signer: seller},
  ];
  testCases.forEach(({primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, signer}) => {
    it(`Investor signatures (primary type: ${primaryType})`, async function() {
      const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
      const { chainId, verifyingContract } = await verifier.eip712Domain();
      const signerAddress = await signer.getAddress();
      const { types, message } = newInvestmentMessage(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement);
      const signature = await sign(chainId, verifyingContract, types, message, signer);
      const offChainHash = hash(chainId, verifyingContract, types, message);
      expect(verify(chainId, verifyingContract, types, message, signerAddress, signature)).to.equal(true);
      const onChainHash = await verifier.hashInvestment(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement);
      expect(await verifier.verifyInvestmentSignature(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, signerAddress, signature)).to.equal(true);
      expect(offChainHash).to.equal(onChainHash);
    });
  })

  it("Receipt proof signature", async function() {
    const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const id = uuidv4();
    const operationType = 'issue';
    const signer = Wallet.createRandom();
    const signerAddress = await signer.getAddress();
    const sourceWallet = Wallet.createRandom();
    const destinationWallet = Wallet.createRandom();
    const sourceFinId = getFinId(sourceWallet);
    const destinationFinId = getFinId(destinationWallet);
    const message = newReceiptMessage(id, operationType,
      source('finId', sourceFinId),
      destination('finId', destinationFinId),
      asset(`bank-us:102:${uuidv4()}`, 'finp2p'),
      `${getRandomNumber(1, 100)}`,
      tradeDetails(executionContext('', '')),
      transactionDetails('', id)
    );

    // const offChainHash = hash(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message);
    const signature = await sign(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message, signer);
    expect(verify(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message, signerAddress, signature)).to.equal(true);
  });


});

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}