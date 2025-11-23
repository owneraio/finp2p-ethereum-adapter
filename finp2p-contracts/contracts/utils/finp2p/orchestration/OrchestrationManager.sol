// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {FinP2P} from "../FinP2P.sol";
import "../../StringUtils.sol";
import {FinP2PSignatureVerifier} from "../verify/FinP2PSignatureVerifier.sol";

contract OrchestrationManager is FinP2PSignatureVerifier {

    using FinP2P for FinP2P.InstructionType;
    using FinP2P for FinP2P.ReceiptOperationType;
    using StringUtils for string;

    mapping(string => FinP2P.ExecutionPlan) private plans;
    mapping(bytes32 => bool) private usedSignatures;

    function createExecutionPlan(string memory id, address operator) external {
        plans[id].id = id;
        plans[id].creator = msg.sender;
        plans[id].operator = operator;
        plans[id].status = FinP2P.ExecutionStatus.CREATED;
        plans[id].currentInstruction = 1;
    }

    function getExecutionPlan(string memory id) external view returns (FinP2P.ExecutionPlan memory) {
        return plans[id];
    }

    function addInstructionToExecution(
        FinP2P.ExecutionContext memory executionContext,
        FinP2P.InstructionType instructionType,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory source,
        string memory destination,
        string memory quantity,
        FinP2P.InstructionExecutor executor,
        string memory proofSigner
    ) external {
        require(plans[executionContext.planId].status == FinP2P.ExecutionStatus.CREATED, "Execution is not in CREATED status");
        require(plans[executionContext.planId].creator == msg.sender, "Only creator can add instructions");
        FinP2P.InstructionStatus status;
        if (executor == FinP2P.InstructionExecutor.THIS_CONTRACT && instructionType.requireInvestorSignature()) {
            status = FinP2P.InstructionStatus.REQUIRE_INVESTOR_SIGNATURE;
        } else {
            status = FinP2P.InstructionStatus.PENDING;
        }
        plans[executionContext.planId].instructions.push(FinP2P.Instruction(executionContext.sequence, instructionType,
            assetId, assetType, source, destination, quantity,
            executor, status, proofSigner));
    }

    function provideInvestorSignature(
        FinP2P.ExecutionContext memory executionContext,
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        FinP2P.Term memory asset,
        FinP2P.Term memory settlement,
        FinP2P.LoanTerm memory loan,
        bytes memory signature
    ) external {
        require(plans[executionContext.planId].status == FinP2P.ExecutionStatus.CREATED, "Execution is not in CREATED status");
        require(plans[executionContext.planId].creator == msg.sender, "Only creator can provide investor signature");
        require(usedSignatures[keccak256(signature)] == false, "Signature already used");
        FinP2P.Instruction memory instruction = plans[executionContext.planId].instructions[executionContext.sequence - 1];
        require(instruction.executor == FinP2P.InstructionExecutor.THIS_CONTRACT, "Instruction executor is not THIS_CONTRACT");
        string memory signerFinId = instruction.source;
        require(verifyInvestmentSignature(
            plans[executionContext.planId].primaryType,
            nonce,
            buyerFinId,
            sellerFinId,
            asset,
            settlement,
            loan,
            signerFinId,
            signature
        ), "Signature is not verified");
        usedSignatures[keccak256(signature)] = true;
        plans[executionContext.planId].instructions[executionContext.sequence - 1].status = FinP2P.InstructionStatus.PENDING;
        if (_isExecutionVerified(executionContext.planId)) {
            plans[executionContext.planId].status = FinP2P.ExecutionStatus.VERIFIED;
        }
    }

    function provideInstructionProof(
        string memory id,
        FinP2P.ReceiptOperationType operation,
        FinP2P.ReceiptSource memory source,
        FinP2P.ReceiptDestination memory destination,
        FinP2P.ReceiptAsset memory asset,
        FinP2P.ReceiptTradeDetails memory tradeDetails,
        FinP2P.ReceiptTransactionDetails memory transactionDetails,
        string memory quantity,
        bytes memory signature
    ) external {
        require(plans[tradeDetails.executionContext.executionPlanId].status == FinP2P.ExecutionStatus.VERIFIED, "Execution is not in VERIFIED status");
        require(plans[tradeDetails.executionContext.executionPlanId].operator == msg.sender, "Only creator can provide instruction proof");
        validateCurrentInstruction(FinP2P.ExecutionContext(tradeDetails.executionContext.executionPlanId,
            tradeDetails.executionContext.instructionSequenceNumber),
            operation.toInstructionType(), FinP2P.InstructionExecutor.OTHER_CONTRACT,
            source.finId, destination.finId, FinP2P.Term(asset.assetId, asset.assetType, quantity));
        string memory signerFinId = _getCurrentInstructionProofSigner(tradeDetails.executionContext.executionPlanId);
        require(verifyReceiptProofSignature(id, operation.toInstructionType(), source, destination,
            asset, tradeDetails, transactionDetails, quantity, signerFinId, signature
        ), "Signature is not verified");
        completeCurrentInstruction(tradeDetails.executionContext.executionPlanId);
    }

    function validateCurrentInstruction(
        FinP2P.ExecutionContext memory executionContext,
        FinP2P.InstructionType instructionType,
        FinP2P.InstructionExecutor instructionExecutor,
        string memory source,
        string memory destination,
        FinP2P.Term memory term
    ) public view {
        require(_haveExecution(executionContext.planId), "Execution not found");
        require(plans[executionContext.planId].status == FinP2P.ExecutionStatus.VERIFIED, "Execution is not in VERIFIED status");
        uint8 currentInstruction = plans[executionContext.planId].currentInstruction;
        FinP2P.Instruction memory instruction = plans[executionContext.planId].instructions[currentInstruction - 1];
        require(instruction.sequence == executionContext.sequence, "Invalid instruction sequence");
        require(instruction.instructionType == instructionType, "Operation does not match");
        require(instruction.executor == instructionExecutor, "Instruction type does not match");
        require(instruction.status == FinP2P.InstructionStatus.PENDING, "Instruction is not in PENDING status");
        require(instruction.assetId.equals(term.assetId), "Asset id does not match");
        require(instruction.assetType == term.assetType, "Asset type does not match");
        require(instruction.amount.equals(term.amount), "Quantity does not match");
        require(instruction.source.equals(source), "Source does not match");
        require(instruction.destination.equals(destination), "Destination does not match");
    }

    function completeCurrentInstruction(string memory planId) public {
        require(_haveExecution(planId), "Execution not found");
        require(plans[planId].operator == msg.sender, "Only creator can complete instruction");

        uint8 currentInstruction = plans[planId].currentInstruction;
        plans[planId].instructions[currentInstruction - 1].status = FinP2P.InstructionStatus.EXECUTED;
        if (_isExecutionCompleted(planId)) {
            plans[planId].status = FinP2P.ExecutionStatus.EXECUTED;
        } else {
            uint currentIdx = currentInstruction;
            for (uint idx = currentIdx; idx < plans[planId].instructions.length; idx++) {
                if (plans[planId].instructions[idx].instructionType != FinP2P.InstructionType.AWAIT) {
                    plans[planId].currentInstruction = uint8(idx + 1);
                    break;
                }
            }
        }
    }

    function failCurrentInstruction(string memory planId, string memory reason) public {
        require(_haveExecution(planId), "Execution not found");
        require(plans[planId].operator == msg.sender, "Only creator can fail instruction");
        uint8 currentInstruction = plans[planId].currentInstruction;
        plans[planId].instructions[currentInstruction - 1].status = FinP2P.InstructionStatus.FAILED;
        plans[planId].status = FinP2P.ExecutionStatus.FAILED;
        plans[planId].failureReason = reason;
    }

    function _getCurrentInstructionProofSigner(string memory executionId) internal view returns (string memory) {
        require(_haveExecution(executionId), "Execution not found");
        uint8 currentInstruction = plans[executionId].currentInstruction;
        FinP2P.Instruction memory instruction = plans[executionId].instructions[currentInstruction - 1];
        require(instruction.executor == FinP2P.InstructionExecutor.OTHER_CONTRACT, "Proof signer only for OTHER_CONTRACT executor");
        return instruction.proofSigner;
    }

    function _isExecutionVerified(string memory id) internal view returns (bool) {
        for (uint i = 0; i < plans[id].instructions.length; i++) {
            if (plans[id].instructions[i].executor == FinP2P.InstructionExecutor.THIS_CONTRACT &&
            plans[id].instructions[i].instructionType.requireInvestorSignature() &&
                plans[id].instructions[i].status == FinP2P.InstructionStatus.REQUIRE_INVESTOR_SIGNATURE) {
                return false;
            }
        }
        return true;
    }

    function _isExecutionCompleted(string memory id) internal view returns (bool) {
        for (uint i = 0; i < plans[id].instructions.length; i++) {
            if (plans[id].instructions[i].sequence > 0 &&
                plans[id].instructions[i].status != FinP2P.InstructionStatus.EXECUTED) {
                return false;
            }
        }
        return true;
    }

    function _haveExecution(string memory id) internal view returns (bool exists) {
        exists = (bytes(plans[id].id).length > 0);
    }

}
