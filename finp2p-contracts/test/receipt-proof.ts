import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuid } from "uuid";
import { Wallet } from "ethers";
import { hashEIP712, signEIP712 } from "../src";
import {
  eip712Asset,
  eip712Destination,
  eip712ExecutionContext,
  eip712Source,
  eip712TradeDetails,
  eip712TransactionDetails,
  newReceiptMessage,
  RECEIPT_PROOF_TYPES
} from "../src/adapter-types";

describe("FinP2PReceiptVerifier", function() {

  async function deployVerifierFixture() {
    const deployer = await ethers.getContractFactory("FinP2PReceiptVerifier");
    const contract = await deployer.deploy();
    const { chainId, verifyingContract } = await contract.eip712Domain();
    return { contract, chainId, verifyingContract };
  }

  const newReceipt = () => ({
    id: uuid(),
    operationType: "transfer",
    sourceAccountType: "finId",
    sourceFinId: "02" + "11".repeat(32),
    destinationAccountType: "finId",
    destinationFinId: "03" + "22".repeat(32),
    assetId: `bank-us:102:${uuid()}`,
    assetType: "finp2p",
    executionPlanId: `bank-us:106:${uuid()}`,
    instructionSequenceNumber: "2",
    operationId: uuid(),
    transactionId: uuid(),
    quantity: "10.50"
  });

  const receiptMessage = (r: ReturnType<typeof newReceipt>) => newReceiptMessage(
    r.id, r.operationType,
    eip712Source(r.sourceAccountType, r.sourceFinId),
    eip712Destination(r.destinationAccountType, r.destinationFinId),
    eip712Asset(r.assetId, r.assetType),
    r.quantity,
    eip712TradeDetails(eip712ExecutionContext(r.executionPlanId, r.instructionSequenceNumber)),
    eip712TransactionDetails(r.operationId, r.transactionId)
  );

  it("on-chain receipt hash matches off-chain RECEIPT_PROOF_TYPES hash", async () => {
    const { contract, chainId, verifyingContract } = await loadFixture(deployVerifierFixture);
    const receipt = newReceipt();
    const offChainHash = hashEIP712(chainId, verifyingContract, RECEIPT_PROOF_TYPES, receiptMessage(receipt));
    const onChainHash = await contract.hashReceipt(receipt);
    expect(onChainHash).to.equal(offChainHash);
  });

  it("verifies and recovers a valid proof signature", async () => {
    const { contract, chainId, verifyingContract } = await loadFixture(deployVerifierFixture);
    const signer = Wallet.createRandom();
    const receipt = newReceipt();
    const signature = await signEIP712(chainId, verifyingContract, RECEIPT_PROOF_TYPES, receiptMessage(receipt), signer);
    expect(await contract.verifyReceiptProofSignature(receipt, signer.address, signature)).to.equal(true);
    expect(await contract.recoverReceiptProofSigner(receipt, signature)).to.equal(signer.address);
  });

  it("recovers the signer from a 64-byte compact (EIP-2098) signature", async () => {
    const { contract, chainId, verifyingContract } = await loadFixture(deployVerifierFixture);
    const signer = Wallet.createRandom();
    const receipt = newReceipt();
    const signature = await signEIP712(chainId, verifyingContract, RECEIPT_PROOF_TYPES, receiptMessage(receipt), signer);
    const compact = ethers.Signature.from(signature).compactSerialized;
    expect(await contract.recoverReceiptProofSigner(receipt, compact)).to.equal(signer.address);
  });

  it("rejects a tampered receipt", async () => {
    const { contract, chainId, verifyingContract } = await loadFixture(deployVerifierFixture);
    const signer = Wallet.createRandom();
    const receipt = newReceipt();
    const signature = await signEIP712(chainId, verifyingContract, RECEIPT_PROOF_TYPES, receiptMessage(receipt), signer);

    for (const tamper of [
      { ...receipt, quantity: "999" },
      { ...receipt, executionPlanId: `bank-us:106:${uuid()}` },
      { ...receipt, instructionSequenceNumber: "3" },
      { ...receipt, destinationFinId: "03" + "33".repeat(32) }
    ]) {
      expect(await contract.verifyReceiptProofSignature(tamper, signer.address, signature)).to.equal(false);
      expect(await contract.recoverReceiptProofSigner(tamper, signature)).to.not.equal(signer.address);
    }
  });

  it("rejects a signature from a different signer", async () => {
    const { contract, chainId, verifyingContract } = await loadFixture(deployVerifierFixture);
    const signer = Wallet.createRandom();
    const impostor = Wallet.createRandom();
    const receipt = newReceipt();
    const signature = await signEIP712(chainId, verifyingContract, RECEIPT_PROOF_TYPES, receiptMessage(receipt), impostor);
    expect(await contract.verifyReceiptProofSignature(receipt, signer.address, signature)).to.equal(false);
  });
});
