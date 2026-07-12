import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuid } from "uuid";
import { Signer, Wallet } from "ethers";
import { PrimaryType } from "./utils";
import { AssetType, finIdToAddress, getFinId, signEIP712, Term, term, termToEIP712 } from "../src";
import {
  EIP712LoanTerms,
  emptyLoanTerms,
  eip712Asset,
  eip712Destination,
  eip712ExecutionContext,
  eip712Source,
  eip712TradeDetails,
  eip712TransactionDetails,
  newInvestmentMessage,
  newReceiptMessage,
  RECEIPT_PROOF_TYPES
} from "../src/adapter-types";
import { ERC20WithOperator, FINP2PPlanOperator, FinP2PEscrow } from "../typechain-types";

// PlanTypes.sol enums
const enum InstructionType {
  Issue = 0, Transfer = 1, Hold = 2, Release = 3, ReleaseAndRedeem = 4, Redeem = 5, Await = 6, RevertHold = 7
}
const enum InstructionExecutor { ThisContract = 0, OtherLedger = 1 }
const enum PlanStatus { None = 0, Created = 1, Executing = 2, Completed = 3, Failed = 4, Reverted = 5 }
const NO_SIGNATURE = 255;

type Investor = { signer: Wallet, finId: string, address: string };

describe("FINP2PPlanOperator", function() {

  async function deployPlanOperatorFixture() {
    const [admin, stranger] = await ethers.getSigners();

    const escrowDeployer = await ethers.getContractFactory("FinP2PEscrow");
    const escrow: FinP2PEscrow = await escrowDeployer.deploy(admin);
    const escrowAddress = await escrow.getAddress();

    const verifierDeployer = await ethers.getContractFactory("FinP2PPlanVerifier");
    const verifier = await verifierDeployer.deploy();
    const verifierAddress = await verifier.getAddress();

    const operatorDeployer = await ethers.getContractFactory("FINP2PPlanOperator");
    const operator: FINP2PPlanOperator = await operatorDeployer.deploy(admin, escrowAddress, verifierAddress);
    const operatorAddress = await operator.getAddress();

    await escrow.grantEscrowOperatorRole(operatorAddress);

    const { chainId, verifyingContract } = await verifier.eip712Domain();

    return { admin, stranger, escrow, escrowAddress, operator, operatorAddress, chainId, verifyingContract };
  }

  const generateInvestor = (): Investor => {
    const signer = Wallet.createRandom();
    const finId = getFinId(signer);
    return { signer, finId, address: finIdToAddress(finId) };
  };

  const generateAssetId = (): string => `bank-us:102:${uuid()}`;
  const generatePlanId = (): string => `bank-us:106:${uuid()}`;

  async function deployToken(
    admin: Signer, operatorAddress: string, escrowAddress: string, decimals: number
  ): Promise<{ token: ERC20WithOperator, tokenAddress: string }> {
    const deployer = await ethers.getContractFactory("ERC20WithOperator");
    const token: ERC20WithOperator = await deployer.deploy("Test token", "TST", decimals, admin);
    await token.grantOperatorTo(operatorAddress);
    await token.grantOperatorTo(escrowAddress);
    await token.grantMinterTo(operatorAddress);
    return { token, tokenAddress: await token.getAddress() };
  }

  type InstructionOverrides = {
    org?: string, source?: string, destination?: string, operationId?: string, signatureIndex?: number
  };

  const instruction = (
    sequence: number,
    instructionType: InstructionType,
    executor: InstructionExecutor,
    assetTerm: Term,
    overrides: InstructionOverrides = {}
  ) => ({
    sequence,
    instructionType,
    executor,
    organizationId: overrides.org ?? "",
    assetId: assetTerm.assetId,
    assetType: assetTerm.assetType,
    source: overrides.source ?? "",
    destination: overrides.destination ?? "",
    amount: assetTerm.amount,
    operationId: overrides.operationId ?? "",
    signatureIndex: overrides.signatureIndex ?? NO_SIGNATURE,
    status: 0
  });

  async function signIntent(
    chainId: bigint, verifyingContract: string,
    primaryType: PrimaryType, buyer: Investor, seller: Investor,
    asset: Term, settlement: Term, loan: EIP712LoanTerms, signer: Wallet
  ) {
    const nonce = uuid();
    const { message, types } = newInvestmentMessage(
      primaryType as number, nonce, buyer.finId, seller.finId, termToEIP712(asset), termToEIP712(settlement), loan);
    const signature = await signEIP712(chainId, verifyingContract, types, message, signer);
    return {
      eip712PrimaryType: primaryType,
      nonce,
      buyerFinId: buyer.finId,
      sellerFinId: seller.finId,
      asset,
      settlement,
      loan,
      signerFinId: getFinId(signer),
      signature
    };
  }

  async function signReceiptProof(
    chainId: bigint, verifyingContract: string, signer: Wallet,
    fields: {
      planId: string, sequence: number, assetId: string, assetType: string,
      sourceFinId: string, destinationFinId: string, quantity: string
    }
  ) {
    const message = newReceiptMessage(
      uuid(), "transfer",
      eip712Source("finId", fields.sourceFinId),
      eip712Destination("finId", fields.destinationFinId),
      eip712Asset(fields.assetId, fields.assetType),
      fields.quantity,
      eip712TradeDetails(eip712ExecutionContext(fields.planId, `${fields.sequence}`)),
      eip712TransactionDetails(uuid(), uuid())
    );
    const signature = await signEIP712(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message, signer);
    // flat ReceiptProof struct as the contract expects it
    const receipt = {
      id: message.id,
      operationType: message.operationType,
      sourceAccountType: message.source.accountType,
      sourceFinId: message.source.finId,
      destinationAccountType: message.destination.accountType,
      destinationFinId: message.destination.finId,
      assetId: message.asset.assetId,
      assetType: message.asset.assetType,
      executionPlanId: message.tradeDetails.executionContext.executionPlanId,
      instructionSequenceNumber: message.tradeDetails.executionContext.instructionSequenceNumber,
      operationId: message.transactionDetails.operationId,
      transactionId: message.transactionDetails.transactionId,
      quantity: message.quantity
    };
    return { receipt, signature };
  }

  // A standard DvP setup: buyer pays 100 settlement units into escrow, seller
  // transfers 10 asset units, escrow releases to seller.
  async function setupDvP(fixture: Awaited<ReturnType<typeof deployPlanOperatorFixture>>) {
    const { admin, operator, operatorAddress, escrowAddress, chainId, verifyingContract } = fixture;

    const buyer = generateInvestor();
    const seller = generateInvestor();
    await operator.addCredential(buyer.finId, buyer.address);
    await operator.addCredential(seller.finId, seller.address);

    const assetTerm = term(generateAssetId(), AssetType.FinP2P, "10");
    const settlementTerm = term("USD", AssetType.Fiat, "100");

    const { token: assetToken } = await deployToken(admin, operatorAddress, escrowAddress, 0);
    const { token: settlementToken } = await deployToken(admin, operatorAddress, escrowAddress, 2);
    await operator.associateAsset(assetTerm.assetId, assetToken);
    await operator.associateAsset(settlementTerm.assetId, settlementToken);

    await assetToken.mint(seller.address, 10);
    await settlementToken.mint(buyer.address, 10000); // "100" at 2 decimals

    const buyerIntent = await signIntent(
      chainId, verifyingContract, PrimaryType.Buying, buyer, seller, assetTerm, settlementTerm, emptyLoanTerms(), buyer.signer);
    const sellerIntent = await signIntent(
      chainId, verifyingContract, PrimaryType.Selling, buyer, seller, assetTerm, settlementTerm, emptyLoanTerms(), seller.signer);

    return { buyer, seller, assetTerm, settlementTerm, assetToken, settlementToken, buyerIntent, sellerIntent };
  }

  describe("createPlan + executeInstruction (local DvP)", () => {

    it("executes a full DvP plan in order", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator, escrowAddress } = fixture;
      const {
        buyer, seller, assetTerm, settlementTerm, assetToken, settlementToken, buyerIntent, sellerIntent
      } = await setupDvP(fixture);

      const planId = generatePlanId();
      const operationId = uuid();
      const instructions = [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId, signatureIndex: 0 }),
        instruction(2, InstructionType.Transfer, InstructionExecutor.ThisContract, assetTerm,
          { source: seller.finId, destination: buyer.finId, signatureIndex: 1 }),
        instruction(3, InstructionType.Release, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId })
      ];

      await expect(operator.createPlan(planId, instructions, [buyerIntent, sellerIntent]))
        .to.emit(operator, "PlanCreated").withArgs(planId, 3);

      expect((await operator.getPlan(planId)).status).to.equal(PlanStatus.Created);

      await expect(operator.executeInstruction(planId, 1))
        .to.emit(operator, "InstructionExecuted").withArgs(planId, 1, InstructionType.Hold);
      expect(await settlementToken.balanceOf(escrowAddress)).to.equal(10000);
      expect((await operator.getPlan(planId)).currentSequence).to.equal(2);
      expect((await operator.getPlan(planId)).status).to.equal(PlanStatus.Executing);

      await operator.executeInstruction(planId, 2);
      expect(await assetToken.balanceOf(buyer.address)).to.equal(10);
      expect(await assetToken.balanceOf(seller.address)).to.equal(0);

      await expect(operator.executeInstruction(planId, 3))
        .to.emit(operator, "PlanCompleted").withArgs(planId);
      expect(await settlementToken.balanceOf(seller.address)).to.equal(10000);
      expect(await settlementToken.balanceOf(escrowAddress)).to.equal(0);
      expect((await operator.getPlan(planId)).status).to.equal(PlanStatus.Completed);
    });

    it("enforces the cursor: out-of-order and repeated execution revert", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator } = fixture;
      const { buyer, seller, assetTerm, settlementTerm, buyerIntent, sellerIntent } = await setupDvP(fixture);

      const planId = generatePlanId();
      const operationId = uuid();
      await operator.createPlan(planId, [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId, signatureIndex: 0 }),
        instruction(2, InstructionType.Transfer, InstructionExecutor.ThisContract, assetTerm,
          { source: seller.finId, destination: buyer.finId, signatureIndex: 1 })
      ], [buyerIntent, sellerIntent]);

      await expect(operator.executeInstruction(planId, 2))
        .to.be.revertedWith("Instruction is not the current one in the plan");

      await operator.executeInstruction(planId, 1);
      await expect(operator.executeInstruction(planId, 1))
        .to.be.revertedWith("Instruction is not the current one in the plan");
    });

    it("rejects execution by a non transaction manager", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator, stranger } = fixture;
      const { buyer, seller, settlementTerm, buyerIntent } = await setupDvP(fixture);

      const planId = generatePlanId();
      const instructions = [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId: uuid(), signatureIndex: 0 })
      ];
      await expect(operator.connect(stranger).createPlan(planId, instructions, [buyerIntent])).to.be.reverted;

      await operator.createPlan(planId, instructions, [buyerIntent]);
      await expect(operator.connect(stranger).executeInstruction(planId, 1)).to.be.reverted;
    });
  });

  describe("createPlan validation", () => {

    it("rejects a hold without an investor signature", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator } = fixture;
      const { buyer, seller, settlementTerm } = await setupDvP(fixture);

      await expect(operator.createPlan(generatePlanId(), [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId: uuid() })
      ], [])).to.be.revertedWith("Asset movement requires an investor signature");
    });

    it("rejects an invalid investor signature", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator } = fixture;
      const { buyer, seller, settlementTerm, buyerIntent } = await setupDvP(fixture);

      const forged = { ...buyerIntent, signature: buyerIntent.signature.slice(0, -4) + "beef" };
      await expect(operator.createPlan(generatePlanId(), [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId: uuid(), signatureIndex: 0 })
      ], [forged])).to.be.revertedWith("Investor signature is not verified");
    });

    it("rejects a signature whose signer differs from the instruction source", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator } = fixture;
      const { buyer, seller, settlementTerm, sellerIntent } = await setupDvP(fixture);

      // seller-signed intent attached to a buyer-sourced settlement hold
      await expect(operator.createPlan(generatePlanId(), [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId: uuid(), signatureIndex: 0 })
      ], [sellerIntent])).to.be.revertedWith("Signature signer differs from the instruction source");
    });

    it("rejects an instruction amount differing from the signed term", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator } = fixture;
      const { buyer, seller, settlementTerm, buyerIntent } = await setupDvP(fixture);

      const inflated = term(settlementTerm.assetId, settlementTerm.assetType, "200");
      await expect(operator.createPlan(generatePlanId(), [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, inflated,
          { source: buyer.finId, destination: seller.finId, operationId: uuid(), signatureIndex: 0 })
      ], [buyerIntent])).to.be.revertedWith("Instruction does not match the signed intent");
    });

    it("rejects reuse of an investor signature across plans", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator } = fixture;
      const { buyer, seller, settlementTerm, buyerIntent } = await setupDvP(fixture);

      const instructions = (operationId: string) => [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId, signatureIndex: 0 })
      ];
      await operator.createPlan(generatePlanId(), instructions(uuid()), [buyerIntent]);
      await expect(operator.createPlan(generatePlanId(), instructions(uuid()), [buyerIntent]))
        .to.be.revertedWith("Investor signature already used");

      // re-encoding the same signature (65-byte r||s||v -> 64-byte r||s) must
      // not bypass the replay guard: it is keyed by signed digest, not bytes
      const reEncoded = { ...buyerIntent, signature: buyerIntent.signature.slice(0, 2 + 64 * 2) };
      await expect(operator.createPlan(generatePlanId(), instructions(uuid()), [reEncoded]))
        .to.be.revertedWith("Investor signature already used");
    });

    it("rejects execution of a release whose amount differs from the escrowed hold", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator } = fixture;
      const { buyer, seller, settlementTerm, buyerIntent } = await setupDvP(fixture);

      // a crafted plan (bypassing the adapter translator) claiming a partial release
      const planId = generatePlanId();
      const operationId = uuid();
      const partialRelease = term(settlementTerm.assetId, settlementTerm.assetType, "1");
      await operator.createPlan(planId, [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId, signatureIndex: 0 }),
        instruction(2, InstructionType.Release, InstructionExecutor.ThisContract, partialRelease,
          { source: buyer.finId, destination: seller.finId, operationId })
      ], [buyerIntent]);

      await operator.executeInstruction(planId, 1);
      await expect(operator.executeInstruction(planId, 2))
        .to.be.revertedWith("Escrow hold amount differs from the instruction amount");
    });

    it("rejects non-contiguous instruction sequences", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator } = fixture;
      const { buyer, seller, settlementTerm, buyerIntent } = await setupDvP(fixture);

      await expect(operator.createPlan(generatePlanId(), [
        instruction(2, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId: uuid(), signatureIndex: 0 })
      ], [buyerIntent])).to.be.revertedWith("Instruction sequences must be contiguous starting at 1");
    });

    it("rejects a duplicate plan", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator } = fixture;
      const { buyer, seller, settlementTerm, buyerIntent, sellerIntent } = await setupDvP(fixture);

      const planId = generatePlanId();
      await operator.createPlan(planId, [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId: uuid(), signatureIndex: 0 })
      ], [buyerIntent]);
      await expect(operator.createPlan(planId, [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId: uuid(), signatureIndex: 0 })
      ], [sellerIntent])).to.be.revertedWith("Plan already exists");
    });

    it("rejects a remote instruction without a registered proof signer", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator } = fixture;
      const { buyer, seller, assetTerm } = await setupDvP(fixture);

      await expect(operator.createPlan(generatePlanId(), [
        instruction(1, InstructionType.Transfer, InstructionExecutor.OtherLedger, assetTerm,
          { org: "bank-uk", source: seller.finId, destination: buyer.finId })
      ], [])).to.be.revertedWith("No proof signers registered for the executing organization");
    });
  });

  describe("cross-ledger instructions", () => {

    async function setupCrossLedgerPlan(fixture: Awaited<ReturnType<typeof deployPlanOperatorFixture>>) {
      const { operator } = fixture;
      const dvp = await setupDvP(fixture);
      const { buyer, seller, assetTerm, settlementTerm, buyerIntent } = dvp;

      const proofSigner = Wallet.createRandom();
      await operator.addProofSigner("bank-uk", proofSigner.address);

      const planId = generatePlanId();
      const operationId = uuid();
      await operator.createPlan(planId, [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId, signatureIndex: 0 }),
        instruction(2, InstructionType.Transfer, InstructionExecutor.OtherLedger, assetTerm,
          { org: "bank-uk", source: seller.finId, destination: buyer.finId }),
        instruction(3, InstructionType.Release, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId })
      ], [buyerIntent]);

      return { ...dvp, proofSigner, planId, operationId };
    }

    it("advances a remote instruction only via a valid receipt proof", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator, chainId, verifyingContract } = fixture;
      const { buyer, seller, assetTerm, settlementTerm, settlementToken, proofSigner, planId } =
        await setupCrossLedgerPlan(fixture);

      await operator.executeInstruction(planId, 1);

      // the remote instruction cannot be executed locally...
      await expect(operator.executeInstruction(planId, 2))
        .to.be.revertedWith("Instruction is not executable on this ledger");

      // ...and cannot be proven by an unregistered signer
      const impostor = Wallet.createRandom();
      const badProof = await signReceiptProof(chainId, verifyingContract, impostor, {
        planId, sequence: 2, assetId: assetTerm.assetId, assetType: "finp2p",
        sourceFinId: seller.finId, destinationFinId: buyer.finId, quantity: assetTerm.amount
      });
      await expect(operator.proveInstruction(planId, 2, badProof.receipt, badProof.signature))
        .to.be.revertedWith("Proof signer is not registered for the executing organization");

      // ...nor with tampered bindings
      const wrongQuantity = await signReceiptProof(chainId, verifyingContract, proofSigner, {
        planId, sequence: 2, assetId: assetTerm.assetId, assetType: "finp2p",
        sourceFinId: seller.finId, destinationFinId: buyer.finId, quantity: "999"
      });
      await expect(operator.proveInstruction(planId, 2, wrongQuantity.receipt, wrongQuantity.signature))
        .to.be.revertedWith("Receipt quantity differs from the planned one");

      const wrongPlan = await signReceiptProof(chainId, verifyingContract, proofSigner, {
        planId: generatePlanId(), sequence: 2, assetId: assetTerm.assetId, assetType: "finp2p",
        sourceFinId: seller.finId, destinationFinId: buyer.finId, quantity: assetTerm.amount
      });
      await expect(operator.proveInstruction(planId, 2, wrongPlan.receipt, wrongPlan.signature))
        .to.be.revertedWith("Receipt proof is for a different plan");

      // a valid proof from the registered signer advances the cursor (permissionless call)
      const { stranger } = fixture;
      const proof = await signReceiptProof(chainId, verifyingContract, proofSigner, {
        planId, sequence: 2, assetId: assetTerm.assetId, assetType: "finp2p",
        sourceFinId: seller.finId, destinationFinId: buyer.finId, quantity: assetTerm.amount
      });
      await expect(operator.connect(stranger).proveInstruction(planId, 2, proof.receipt, proof.signature))
        .to.emit(operator, "InstructionProven").withArgs(planId, 2, proofSigner.address);

      // now the release is unblocked
      await operator.executeInstruction(planId, 3);
      expect(await settlementToken.balanceOf(seller.address)).to.equal(10000);
      expect((await operator.getPlan(planId)).status).to.equal(PlanStatus.Completed);
    });

    it("rejects a proof for a non-current sequence", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator, chainId, verifyingContract } = fixture;
      const { buyer, seller, assetTerm, proofSigner, planId } = await setupCrossLedgerPlan(fixture);

      // cursor is still at 1
      const proof = await signReceiptProof(chainId, verifyingContract, proofSigner, {
        planId, sequence: 2, assetId: assetTerm.assetId, assetType: "finp2p",
        sourceFinId: seller.finId, destinationFinId: buyer.finId, quantity: assetTerm.amount
      });
      await expect(operator.proveInstruction(planId, 2, proof.receipt, proof.signature))
        .to.be.revertedWith("Instruction is not the current one in the plan");
    });
  });

  describe("failure and revert", () => {

    it("rolls back executed holds of a failed plan", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator, escrowAddress } = fixture;
      const { buyer, seller, assetTerm, settlementTerm, settlementToken, buyerIntent, sellerIntent } =
        await setupDvP(fixture);

      const planId = generatePlanId();
      const operationId = uuid();
      await operator.createPlan(planId, [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId, signatureIndex: 0 }),
        instruction(2, InstructionType.Transfer, InstructionExecutor.ThisContract, assetTerm,
          { source: seller.finId, destination: buyer.finId, signatureIndex: 1 }),
        instruction(3, InstructionType.Release, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId })
      ], [buyerIntent, sellerIntent]);

      await operator.executeInstruction(planId, 1);
      expect(await settlementToken.balanceOf(escrowAddress)).to.equal(10000);

      await expect(operator.failPlan(planId, "counterparty timeout"))
        .to.emit(operator, "PlanFailed").withArgs(planId, "counterparty timeout");

      await expect(operator.executeInstruction(planId, 2))
        .to.be.revertedWith("Plan is not active");

      await expect(operator.revertPlan(planId))
        .to.emit(operator, "PlanReverted").withArgs(planId);

      expect(await settlementToken.balanceOf(buyer.address)).to.equal(10000);
      expect(await settlementToken.balanceOf(escrowAddress)).to.equal(0);
      expect((await operator.getPlan(planId)).status).to.equal(PlanStatus.Reverted);
    });

    it("revert requires a failed plan", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { operator } = fixture;
      const { buyer, seller, settlementTerm, buyerIntent } = await setupDvP(fixture);

      const planId = generatePlanId();
      await operator.createPlan(planId, [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, settlementTerm,
          { source: buyer.finId, destination: seller.finId, operationId: uuid(), signatureIndex: 0 })
      ], [buyerIntent]);

      await expect(operator.revertPlan(planId)).to.be.revertedWith("Plan is not failed");
    });
  });

  describe("issue and redeem plans", () => {

    it("executes issue, hold and release-and-redeem without signatures where not required", async () => {
      const fixture = await loadFixture(deployPlanOperatorFixture);
      const { admin, operator, operatorAddress, escrowAddress, chainId, verifyingContract } = fixture;

      const issuer = generateInvestor();
      const investor = generateInvestor();
      await operator.addCredential(issuer.finId, issuer.address);
      await operator.addCredential(investor.finId, investor.address);

      const assetTerm = term(generateAssetId(), AssetType.FinP2P, "50");
      const { token: assetToken } = await deployToken(admin, operatorAddress, escrowAddress, 0);
      await operator.associateAsset(assetTerm.assetId, assetToken);

      // issuance: mint to the issuer
      const issuePlanId = generatePlanId();
      await operator.createPlan(issuePlanId, [
        instruction(1, InstructionType.Issue, InstructionExecutor.ThisContract, assetTerm,
          { destination: investor.finId })
      ], []);
      await operator.executeInstruction(issuePlanId, 1);
      expect(await assetToken.balanceOf(investor.address)).to.equal(50);

      // redemption: investor holds into escrow (signed), then release-and-burn
      const settlementTerm = term("USD", AssetType.Fiat, "500");
      const redemptionIntent = await signIntent(
        chainId, verifyingContract, PrimaryType.Redemption, issuer, investor, assetTerm, settlementTerm,
        emptyLoanTerms(), investor.signer);

      const redeemPlanId = generatePlanId();
      const operationId = uuid();
      await operator.createPlan(redeemPlanId, [
        instruction(1, InstructionType.Hold, InstructionExecutor.ThisContract, assetTerm,
          { source: investor.finId, operationId, signatureIndex: 0 }),
        instruction(2, InstructionType.ReleaseAndRedeem, InstructionExecutor.ThisContract, assetTerm,
          { source: investor.finId, operationId })
      ], [redemptionIntent]);

      await operator.executeInstruction(redeemPlanId, 1);
      expect(await assetToken.balanceOf(escrowAddress)).to.equal(50);

      await operator.executeInstruction(redeemPlanId, 2);
      expect(await assetToken.totalSupply()).to.equal(0);
      expect((await operator.getPlan(redeemPlanId)).status).to.equal(PlanStatus.Completed);
    });
  });
});
