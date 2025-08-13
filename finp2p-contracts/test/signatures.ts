import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { generateNonce } from "./utils";
import { v4 as uuidv4 } from "uuid";
import { HDNodeWallet, Wallet } from "ethers";
import { finIdToAddress, getFinId } from "../src/contracts/utils";
import {
  eip712Asset,
  eip712Destination,
  eip712ExecutionContext,
  EIP712LoanTerms,
  eip712Source,
  eip712TradeDetails,
  eip712TransactionDetails,
  emptyLoanTerms,
  hash,
  loanTerms,
  newInvestmentMessage,
  newReceiptMessage,
  PrimaryType,
  RECEIPT_PROOF_TYPES,
  sign,
  verify
} from "../src/contracts/eip712";
import { AssetType, term, Term, termToEIP712 } from "../src/contracts/model";


describe("Signing test", function() {
  async function deployFinP2PSignatureVerifier() {
    const deployer = await ethers.getContractFactory("FinP2PSignatureVerifier");
    const contract = await deployer.deploy();
    const address = await contract.getAddress();
    return { contract, address };
  }

  const buyer = Wallet.createRandom();
  const seller = Wallet.createRandom();

  const testCases: {
    primaryType: PrimaryType,
    nonce: string,
    buyerFinId: string,
    sellerFinId: string,
    asset: Term,
    settlement: Term,
    loan: EIP712LoanTerms,
    signer: HDNodeWallet
  }[] = [{
    primaryType: PrimaryType.PrimarySale,
    nonce: `${generateNonce().toString("hex")}`,
    buyerFinId: getFinId(buyer),
    sellerFinId: getFinId(seller),
    asset: term(`bank-us:102:${uuidv4()}`, AssetType.FinP2P, `${getRandomNumber(1, 100)}`),
    settlement: term("USD", AssetType.Fiat, `${getRandomNumber(1, 100)}`),
    loan: emptyLoanTerms(),
    signer: seller
  }, {
    primaryType: PrimaryType.Buying,
    nonce: `${generateNonce().toString("hex")}`,
    buyerFinId: getFinId(buyer),
    sellerFinId: getFinId(seller),
    asset: term(`bank-us:102:${uuidv4()}`, AssetType.FinP2P, `${getRandomNumber(1, 100)}`),
    settlement: term("USD", AssetType.Fiat, `${getRandomNumber(1, 100)}`),
    loan: emptyLoanTerms(),
    signer: seller
  }, {
    primaryType: PrimaryType.Selling,
    nonce: `${generateNonce().toString("hex")}`,
    buyerFinId: getFinId(buyer),
    sellerFinId: getFinId(seller),
    asset: term(`bank-us:102:${uuidv4()}`, AssetType.FinP2P, `${getRandomNumber(1, 100)}`),
    settlement: term("USD", AssetType.Fiat, `${getRandomNumber(1, 100)}`),
    loan: emptyLoanTerms(),
    signer: seller
  }, {
    primaryType: PrimaryType.Redemption,
    nonce: `${generateNonce().toString("hex")}`,
    buyerFinId: getFinId(buyer),
    sellerFinId: getFinId(seller),
    asset: term(`bank-us:102:${uuidv4()}`, AssetType.FinP2P, `${getRandomNumber(1, 100)}`),
    settlement: term("USD", AssetType.Fiat, `${getRandomNumber(1, 100)}`),
    loan: emptyLoanTerms(),
    signer: seller
  }, {
    primaryType: PrimaryType.Transfer,
    nonce: `${generateNonce().toString("hex")}`,
    buyerFinId: getFinId(buyer),
    sellerFinId: getFinId(seller),
    asset: term(`bank-us:102:${uuidv4()}`, AssetType.FinP2P, `${getRandomNumber(1, 100)}`),
    settlement: term("USD", AssetType.Fiat, `${getRandomNumber(1, 100)}`),
    loan: emptyLoanTerms(),
    signer: seller
  }, {
    primaryType: PrimaryType.PrivateOffer,
    nonce: `${generateNonce().toString("hex")}`,
    buyerFinId: getFinId(buyer),
    sellerFinId: getFinId(seller),
    asset: term(`bank-us:102:${uuidv4()}`, AssetType.FinP2P, `${getRandomNumber(1, 100)}`),
    settlement: term("USD", AssetType.Fiat, `${getRandomNumber(1, 100)}`),
    loan: emptyLoanTerms(),
    signer: seller
  }, {
    primaryType: PrimaryType.Loan,
    nonce: `${generateNonce().toString("hex")}`,
    buyerFinId: getFinId(buyer),
    sellerFinId: getFinId(seller),
    asset: term(`bank-us:102:${uuidv4()}`, AssetType.FinP2P, `${getRandomNumber(1, 100)}`),
    settlement: term("USD", AssetType.Fiat, `${getRandomNumber(1, 100)}`),
    loan: loanTerms("2025-01-01", "2025-01-02", "1000000.00", "1000123.71"),
    signer: seller
  }];
  testCases.forEach(({ primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, loan, signer }) => {
    it(`Investor signatures (primary type: ${primaryType})`, async function() {
      const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
      const { chainId, verifyingContract } = await verifier.eip712Domain();
      const signerAddress = await signer.getAddress();
      expect(signerAddress.toLowerCase()).to.equal(finIdToAddress(sellerFinId).toLowerCase());
      const {
        types,
        message
      } = newInvestmentMessage(primaryType, nonce, buyerFinId, sellerFinId, termToEIP712(asset), termToEIP712(settlement), loan);
      const signature = await sign(chainId, verifyingContract, types, message, signer);
      const offChainHash = hash(chainId, verifyingContract, types, message);
      expect(verify(chainId, verifyingContract, types, message, signerAddress, signature)).to.equal(true);
      const onChainHash = await verifier.hashInvestment(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, loan);
      expect(offChainHash).to.equal(onChainHash);
      expect(await verifier.verifyInvestmentSignature(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, loan, getFinId(signer), signature)).to.equal(true);
    });
  });

  it.skip("Investor signature from platform", async function() {
    const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
    const chainId = 1337;
    const verifyingContract = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const nonce = "e78c3a7f564c19667a7d90285e7fe443eca8403d45a2eea80000000067d1907d";
    // borrower
    const sellerFinId = "03da4a23d6385d7f591350f55d98176902580b8ed0412fe54de28a59d5fd5d1af7";
    // lender
    const buyerFinId = "02d34fde92bcd3baef081118e1e5fe9154ff47176a4118cc27b10f5347a56bec23";
    const asset = term("bank-us:102:66fe5a05-ffc6-4754-8d46-68e8abd0e083", AssetType.FinP2P, "1");
    const settlement = term("USD", AssetType.Fiat, "900");
    const loan = loanTerms("1741787256", "1741787271", "900", "900.25");
    const primaryType = PrimaryType.Loan;
    const {
      message,
      types
    } = newInvestmentMessage(primaryType, nonce, buyerFinId, sellerFinId, termToEIP712(asset), termToEIP712(settlement), loan);
    const offChainHash = hash(chainId, verifyingContract, types, message);
    const onChainHash = await verifier.hashInvestment(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, loan);

    const platformHash = "0x28fc646eb6470c62252c9d4c2092bf34d86e590983429580b04578a8ff37e171";
    const platformSignature = "0xd9c145d6f0f020276f268a83178ba08767eaab8fb71475a14f0a5c13275675885f6e89270cfca55cd9e9da29a9412564a2840af5680782f61cb7646181efbe941c";
    expect(offChainHash).to.equal(platformHash);
    expect(offChainHash).to.equal(onChainHash);

    // const signerAddress = finIdToEthereumAddress(sellerFinId);
    // expect(verify(chainId, verifyingContract, types, message, signerAddress, platformSignature)).to.equal(true);
    expect(await verifier.verifyInvestmentSignature(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, loan, sellerFinId, platformSignature)).to.equal(true);
  });

  it("Receipt proof signature", async function() {
    const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const id = uuidv4();
    const operationType = "issue";
    const signer = Wallet.createRandom();
    const signerAddress = await signer.getAddress();
    const sourceWallet = Wallet.createRandom();
    const destinationWallet = Wallet.createRandom();
    const sourceFinId = getFinId(sourceWallet);
    const destinationFinId = getFinId(destinationWallet);
    const message = newReceiptMessage(id, operationType, eip712Source("finId", sourceFinId),
      eip712Destination("finId", destinationFinId),
      eip712Asset(`bank-us:102:${uuidv4()}`, "finp2p"),
      `${getRandomNumber(1, 100)}`,
      eip712TradeDetails(eip712ExecutionContext(`some-bank:106:${uuidv4()}`, "")),
      eip712TransactionDetails("", id));

    // const offChainHash = hash(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message);
    const signature = await sign(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message, signer);
    expect(verify(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message, signerAddress, signature)).to.equal(true);
  });


});

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
