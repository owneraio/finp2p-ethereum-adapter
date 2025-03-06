import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { generateNonce } from "./utils";
import { v4 as uuidv4 } from "uuid";
import { HDNodeWallet, Signer, Wallet } from "ethers";
import { compactSerialize, finIdToEthereumAddress, getFinId } from "../src/contracts/utils";
import {
  asset,
  destination,
  executionContext, finId,
  hash,
  newInvestmentMessage,
  newReceiptMessage,
  PrimaryType,
  RECEIPT_PROOF_TYPES, REDEMPTION_TYPES,
  sign,
  source,
  term,
  Term,
  tradeDetails,
  transactionDetails,
  verify
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

  const testCases: {primaryType: PrimaryType, nonce: string, buyerFinId: string, sellerFinId: string, asset: Term, settlement: Term, signer: HDNodeWallet}[] = [
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
      expect(await verifier.verifyInvestmentSignature(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, getFinId(signer), signature)).to.equal(true);
      expect(offChainHash).to.equal(onChainHash);
    });
  })

  it("Investor signature from platform", async function() {
     const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
     const chainId = 1;
     const verifyingContract = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC';
     const nonce = '6538672b9094b628bebe315da55e01d646b258e374b54ad40000000067c80ce7';
     const sellerFinId = '03646c3ac84cd5d6caa06cef5b851d34dc16513f31361cf9949fa942f6f96cf87d';
     const issuerFinId = '029348c7dfeacaf640d59dcd222493109325e39bf78b4218f087f36283710d83aa';
     const asset = term('adhara-tokenization:102:8f3d599d-aa36-446e-9638-5c4b3ea7469c', 'finp2p', '10');
     const settlement = term('GBP', 'fiat', '10');
     const primaryType = PrimaryType.Redemption;
     const { message, types } = newInvestmentMessage(primaryType, nonce, issuerFinId, sellerFinId, asset, settlement);
     const offChainHash = hash(chainId, verifyingContract, types, message);
     const onChainHash = await verifier.hashInvestment(primaryType, nonce,  issuerFinId, sellerFinId, asset, settlement);

     const platformHash = '0x7bc4ead93144dba191c1fb8a8f2bf5926958c03006513498423ac4ed9dbb30d7';
     const platformSignature = '0x307849e93b819c907217ac05576ac43e4a0db8e7d2a0db2bfd0a060405ee7f9f220309a8ca617bbbc7aa6acc15b2cb7861dec5055d038ed56cbbc34520fea3c9';
     expect(offChainHash).to.equal(platformHash);
     expect(offChainHash).to.equal(onChainHash);

     // const signerAddress = finIdToEthereumAddress(sellerFinId);
     // expect(verify(chainId, verifyingContract, types, message, signerAddress, platformSignature)).to.equal(true);
     expect(await verifier.verifyInvestmentSignature(primaryType, nonce, issuerFinId, sellerFinId, asset, settlement, sellerFinId, platformSignature)).to.equal(true);
  });

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