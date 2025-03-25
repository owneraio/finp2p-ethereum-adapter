// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;
import "./FinP2PSignatureVerifier.sol";
import {FinP2P} from "./FinP2P.sol";

contract ExecutionContextManager is FinP2PSignatureVerifier {

    using FinP2P for FinP2P.OperationType;
    using StringUtils for string;

    mapping(string => FinP2P.ExecutionPlan) private executions;

    function createExecutionContext(string memory id) external {
        executions[id].id = id;
        executions[id].status = FinP2P.ExecutionStatus.CREATED;
        executions[id].currentInstruction = 1;
    }

    function addInstructionToExecution(
        FinP2P.ExecutionContext memory executionContext,
        FinP2P.OperationType operation,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory source,
        string memory destination,
        string memory amount,
        FinP2P.InstructionExecutor executor,
        string memory proofSigner
    ) external {
        require(executions[executionContext.planId].status == FinP2P.ExecutionStatus.CREATED, "Execution is not in CREATED status");
        FinP2P.InstructionStatus status;
        if (executor == FinP2P.InstructionExecutor.THIS_CONTRACT && operation.requireInvestorSignature()) {
            status = FinP2P.InstructionStatus.REQUIRE_INVESTOR_SIGNATURE;
        } else {
            status = FinP2P.InstructionStatus.PENDING;
        }
        executions[executionContext.planId].instructions.push(FinP2P.Instruction(executionContext.sequence, operation,
            assetId, assetType, source, destination, amount,
            executor, status, proofSigner));
    }

    function provideInvestorSignature(
        FinP2P.ExecutionContext memory executionContext,
        FinP2P.Domain memory domain,
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        FinP2P.Term memory asset,
        FinP2P.Term memory settlement,
        FinP2P.LoanTerm memory loan,
        bytes memory signature
    ) external {
//        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to transfer asset");
        require(executions[executionContext.planId].status == FinP2P.ExecutionStatus.CREATED, "Execution is not in CREATED status");
        FinP2P.Instruction memory instruction = executions[executionContext.planId].instructions[executionContext.sequence - 1];
        require(instruction.executor == FinP2P.InstructionExecutor.THIS_CONTRACT, "Instruction executor is not THIS_CONTRACT");
        string memory signerFinId = instruction.source;
        require(verifyInvestmentSignature(
            executions[executionContext.planId].primaryType,
            domain,
            nonce,
            buyerFinId,
            sellerFinId,
            asset,
            settlement,
            loan,
            signerFinId,
            signature
        ), "Signature is not verified");
        executions[executionContext.planId].instructions[executionContext.sequence - 1].status = FinP2P.InstructionStatus.PENDING;
        if (_isExecutionVerified(executionContext.planId)) {
            executions[executionContext.planId].status = FinP2P.ExecutionStatus.VERIFIED;
        }
    }

    function provideInstructionProof(
        FinP2P.Domain memory domain,
        string memory id,
        FinP2P.OperationType operation,
        FinP2P.ReceiptSource memory source,
        FinP2P.ReceiptDestination memory destination,
        FinP2P.ReceiptAsset memory asset,
        FinP2P.ReceiptTradeDetails memory tradeDetails,
        FinP2P.ReceiptTransactionDetails memory transactionDetails,
        string memory quantity,
        bytes memory signature
    ) external  {
        require(executions[tradeDetails.executionContext.executionPlanId].status == FinP2P.ExecutionStatus.VERIFIED, "Execution is not in VERIFIED status");
        validateCurrentInstruction(FinP2P.ExecutionContext(tradeDetails.executionContext.executionPlanId, tradeDetails.executionContext.instructionSequenceNumber),
            operation, FinP2P.InstructionExecutor.OTHER_CONTRACT,
            source.finId, destination.finId, asset.assetId, asset.assetType, quantity);
        string memory signerFinId = _getCurrentInstructionProofSigner(tradeDetails.executionContext.executionPlanId);
        require(verifyReceiptProofSignature(domain, id, operation, source, destination,
            asset, tradeDetails, transactionDetails, quantity, signerFinId, signature
        ), "Signature is not verified");
        completeCurrentInstruction(tradeDetails.executionContext.executionPlanId);
    }

    function validateCurrentInstruction(
        FinP2P.ExecutionContext memory executionContext,
        FinP2P.OperationType operation,
        FinP2P.InstructionExecutor instructionExecutor,
        string memory source,
        string memory destination,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory quantity
    ) public view {
        require(_haveExecution(executionContext.planId), "Execution not found");
        require(executions[executionContext.planId].status == FinP2P.ExecutionStatus.VERIFIED, "Execution is not in VERIFIED status");
        uint8 currentInstruction = executions[executionContext.planId].currentInstruction;
        FinP2P.Instruction memory instruction = executions[executionContext.planId].instructions[currentInstruction - 1];
        require(instruction.sequence == executionContext.sequence, "Invalid instruction sequence");
        require(instruction.operation == operation, "Operation does not match");
        require(instruction.executor == instructionExecutor, "Instruction type does not match");
        require(instruction.status == FinP2P.InstructionStatus.PENDING, "Instruction is not in PENDING status");
        require(instruction.assetId.equals(assetId), "Asset id does not match");
        require(instruction.assetType == assetType, "Asset type does not match");
        require(instruction.amount.equals(quantity), "Quantity does not match");
        require(instruction.source.equals(source), "Source does not match");
        require(instruction.destination.equals(destination), "Destination does not match");
    }

    function _getCurrentInstructionProofSigner(string memory executionId) internal view returns (string memory) {
        require(_haveExecution(executionId), "Execution not found");
        uint8 currentInstruction = executions[executionId].currentInstruction;
        FinP2P.Instruction memory instruction = executions[executionId].instructions[currentInstruction - 1];
        require(instruction.executor == FinP2P.InstructionExecutor.OTHER_CONTRACT, "Proof signer only for OTHER_CONTRACT executor");
        return instruction.proofSigner;
    }

    function completeCurrentInstruction(string memory id) public {
        require(_haveExecution(id), "Execution not found");
        uint8 currentInstruction = executions[id].currentInstruction;
        executions[id].instructions[currentInstruction - 1].status = FinP2P.InstructionStatus.EXECUTED;
        if (_isExecutionCompleted(id)) {
            executions[id].status = FinP2P.ExecutionStatus.EXECUTED;
        } else {
            uint currentIdx = currentInstruction - 1;
            for (uint i = currentIdx + 1; i < executions[id].instructions.length; i++) {
                if (executions[id].instructions[i].sequence > 0) {
                    executions[id].currentInstruction = uint8(i);
                    break;
                }
            }
        }
    }

    function _isExecutionVerified(string memory id) internal view returns (bool) {
        for (uint i = 0; i < executions[id].instructions.length; i++) {
            if (executions[id].instructions[i].executor == FinP2P.InstructionExecutor.THIS_CONTRACT &&
            executions[id].instructions[i].operation.requireInvestorSignature() &&
                executions[id].instructions[i].status == FinP2P.InstructionStatus.REQUIRE_INVESTOR_SIGNATURE) {
                return false;
            }
        }
        return true;
    }

    function _isExecutionCompleted(string memory id) internal view returns (bool) {
        for (uint i = 0; i < executions[id].instructions.length; i++) {
            if (executions[id].instructions[i].sequence > 0 &&
                executions[id].instructions[i].status != FinP2P.InstructionStatus.EXECUTED) {
                return false;
            }
        }
        return true;
    }

    function _haveExecution(string memory id) internal view returns (bool exists) {
        exists = (bytes(executions[id].id).length > 0);
    }

}