import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { hashEIP712, signEIP712, verifyEIP712 } from "../src";
import { generateNonce } from "./utils";
import { v4 as uuidv4 } from "uuid";
import { HDNodeWallet, Wallet } from "ethers";
import { finIdToAddress, getFinId } from "../src";
import {
  eip712Asset,
  eip712Destination,
  eip712ExecutionContext,
  EIP712LoanTerms,
  eip712Source,
  eip712TradeDetails,
  eip712TransactionDetails,
  emptyLoanTerms,
  loanTerms,
  newInvestmentMessage,
  newReceiptMessage,
  RECEIPT_PROOF_TYPES
} from "../src/adapter-types";
import { AssetType, term, Term, termToEIP712 } from "../src";

import { PrimaryType } from "./utils";

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
      const signerFinId = sellerFinId;
      expect(signerAddress.toLowerCase()).to.equal(finIdToAddress(signerFinId).toLowerCase());
      const {
        types,
        message
      } = newInvestmentMessage(primaryType, nonce, buyerFinId, sellerFinId, termToEIP712(asset), termToEIP712(settlement), loan);
      const signature = await signEIP712(chainId, verifyingContract, types, message, signer);
      const offChainHash = hashEIP712(chainId, verifyingContract, types, message);
      expect(verifyEIP712(chainId, verifyingContract, types, message, signerFinId, signature)).to.equal(true);
      const onChainHash = await verifier.hashInvestment(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, loan);
      expect(offChainHash).to.equal(onChainHash);
      expect(await verifier.verifyInvestmentSignature(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, loan, getFinId(signer), signature)).to.equal(true);
    });
  });

  it("Selling signature from platform (0.28 wire format)", async function() {
    // Real captured payload from the platform. Exercises:
    //  - off-chain EIP712 hash matches the platform-computed hash byte-for-byte
    //    (validates new 0.28 Term shape: { assetId, amount } — no assetType)
    //  - off-chain signer recovery returns the seller's derived EVM address
    const chainId = 1;
    const verifyingContract = "0x0000000000000000000000000000000000000000";
    const nonce = "75dbdf185a9ca33c5c1ef14d4cf1342c";
    const buyerFinId  = "03897e68c1dc647ccb03875b1267c12ec7bcaaea7084b262b131d5fccef714433b";
    const sellerFinId = "03f38f6b90efab51ed88e12e919e4975027c4cde5309bf4a82d89039f774b70446";
    const asset      = term("name: sepolia, chainId: 11155111/ERC20:0x9f9bd18b402ee53dab974defd5ff1be2a3f2aaea", AssetType.FinP2P, "5");
    const settlement = term("vanilla/high:12d019fc-4e4f-49aa-9121-4968c54240ba",                                AssetType.FinP2P, "50");
    const primaryType = PrimaryType.Selling;
    const { message, types } = newInvestmentMessage(primaryType, nonce, buyerFinId, sellerFinId, termToEIP712(asset), termToEIP712(settlement));

    const platformHash = "0xb728c7c6dc6f42d61979bb5095a4c1ec97b29250681eb36ae215e25cff8700d1";
    const platformSignature = "0x05bba94ca10eef6c6485374146d82c5e166a9a8460c019796552c22f50394ee90409fb56f35af7b5c7abbc5371fd7fd121bcf6a1833acce1929549c8dda9a96d1c";

    expect(hashEIP712(chainId, verifyingContract, types, message)).to.equal(platformHash);
    expect(verifyEIP712(chainId, verifyingContract, types, message, sellerFinId, platformSignature)).to.equal(true);
  });

  it("Receipt proof signature", async function() {
    const { contract: verifier } = await loadFixture(deployFinP2PSignatureVerifier);
    const { chainId, verifyingContract } = await verifier.eip712Domain();
    const id = uuidv4();
    const operationType = "issue";
    const signer = Wallet.createRandom();
    const signerFinId = getFinId(signer);
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
    const signature = await signEIP712(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message, signer);
    expect(verifyEIP712(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message, signerFinId, signature)).to.equal(true);
  });


});

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
