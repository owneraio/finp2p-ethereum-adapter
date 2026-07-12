// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {PrimaryType} from "@owneraio/finp2p-ethereum-token-standard/contracts/OperationParams.sol";
import "../../utils/StringUtils.sol";
import {FinIdUtils} from "../../utils/finp2p/FinIdUtils.sol";
import {FinP2PReceiptVerifier} from "../../utils/finp2p/FinP2PReceiptVerifier.sol";
import {Signature} from "../../utils/finp2p/Signature.sol";
import "./PlanTypes.sol";

/**
 * @dev Stateless verification companion of the FINP2PPlanOperator. Deployed
 * separately (and shareable between operators) so the operator itself stays
 * under the EIP-170 bytecode limit: all signature checking and plan/receipt
 * consistency logic lives here, all state stays in the operator.
 */
contract FinP2PPlanVerifier is FinP2PReceiptVerifier {
    using StringUtils for string;
    using StringUtils for uint256;
    using FinIdUtils for string;

    /// @notice Verify a bundled investor intent (see PlanTypes.SignaturePayload).
    /// @return valid  whether the signature matches the signer's finId
    /// @return digest the EIP-712 digest of the signed intent. Replay guards
    ///         must key on this digest (plus signer), never on the signature
    ///         bytes: the same signature is valid in several encodings
    ///         (64-byte r||s and 65-byte r||s||v), so byte-keyed guards can
    ///         be bypassed by re-encoding.
    function verifySignaturePayload(SignaturePayload calldata payload) external view returns (bool valid, bytes32 digest) {
        digest = hashInvestment(
            payload.eip712PrimaryType,
            payload.nonce,
            payload.buyerFinId,
            payload.sellerFinId,
            payload.asset,
            payload.settlement,
            payload.loan
        );
        valid = Signature.verify(payload.signerFinId.toAddress(), digest, payload.signature);
    }

    /// @notice Validate a local (this-ledger) instruction at plan creation:
    ///         required fields and, for asset movements, an attached investor
    ///         intent that authorizes exactly this movement.
    function validateInstruction(
        Instruction calldata instruction,
        SignaturePayload[] calldata signatures
    ) external pure {
        InstructionType instructionType = instruction.instructionType;
        if (instructionType == InstructionType.ISSUE) {
            require(bytes(instruction.destination).length > 0, "Issue instruction must have a destination");
        } else if (instructionType == InstructionType.TRANSFER || instructionType == InstructionType.HOLD) {
            require(bytes(instruction.source).length > 0, "Instruction must have a source");
            require(instruction.signatureIndex != NO_SIGNATURE, "Asset movement requires an investor signature");
            require(instruction.signatureIndex < signatures.length, "Signature index out of bounds");
            SignaturePayload calldata payload = signatures[instruction.signatureIndex];
            require(payload.signerFinId.equals(instruction.source), "Signature signer differs from the instruction source");
            require(intentMatchesInstruction(instruction, payload), "Instruction does not match the signed intent");
        } else if (instructionType == InstructionType.REDEEM) {
            require(bytes(instruction.source).length > 0, "Redeem instruction must have a source");
        } else if (instructionType == InstructionType.RELEASE) {
            require(bytes(instruction.destination).length > 0, "Release instruction must have a destination");
        }
        if (
            instructionType == InstructionType.HOLD ||
            instructionType == InstructionType.RELEASE ||
            instructionType == InstructionType.RELEASE_AND_REDEEM ||
            instructionType == InstructionType.REVERT_HOLD
        ) {
            require(bytes(instruction.operationId).length > 0, "Escrow instruction must have an operationId");
        }
    }

    /// @notice Validate the escrow linkage of a whole plan at creation time:
    ///         every on-ledger RELEASE / RELEASE_AND_REDEEM / REVERT_HOLD must
    ///         reference a PRECEDING on-ledger HOLD of the same plan with the
    ///         same operationId and consistent asset/amount/source (and, for
    ///         RELEASE, destination). Combined with the escrow's rejection of
    ///         duplicate operationIds this proves hold ownership: a plan can
    ///         only terminate holds its own HOLD instruction created — it
    ///         cannot be crafted to release or burn another plan's hold.
    function validatePlanStructure(Instruction[] calldata instructions) external pure {
        for (uint256 i = 0; i < instructions.length; i++) {
            Instruction calldata instr = instructions[i];
            if (instr.venue != ExecutionVenue.ON_LEDGER) continue;
            InstructionType t = instr.instructionType;
            if (
                t != InstructionType.RELEASE &&
                t != InstructionType.RELEASE_AND_REDEEM &&
                t != InstructionType.REVERT_HOLD
            ) continue;

            bool found = false;
            for (uint256 j = 0; j < i; j++) {
                Instruction calldata hold = instructions[j];
                if (
                    hold.instructionType != InstructionType.HOLD ||
                    hold.venue != ExecutionVenue.ON_LEDGER ||
                    !hold.operationId.equals(instr.operationId)
                ) continue;
                require(
                    hold.assetId.equals(instr.assetId) &&
                    hold.amount.equals(instr.amount) &&
                    hold.source.equals(instr.source),
                    "Escrow instruction differs from its hold"
                );
                if (t == InstructionType.RELEASE) {
                    // destinationless (redeem-style) holds are reserved for
                    // RELEASE_AND_REDEEM / REVERT_HOLD — a RELEASE may only
                    // pay the destination the hold was pinned to
                    require(
                        bytes(hold.destination).length != 0 && hold.destination.equals(instr.destination),
                        "Escrow instruction differs from its hold"
                    );
                }
                found = true;
                break;
            }
            require(found, "Escrow instruction has no matching hold in the plan");
        }
    }

    /// @notice Check a receipt proof's binding to a plan instruction and recover
    ///         its signer. Reverts on any mismatch; registry membership of the
    ///         returned signer is checked by the operator.
    function verifyReceiptProof(
        ReceiptProof calldata receipt,
        Instruction calldata instruction,
        string calldata planId,
        uint8 sequence,
        bytes calldata signature
    ) external view returns (address) {
        require(receipt.executionPlanId.equals(planId), "Receipt proof is for a different plan");
        require(receipt.instructionSequenceNumber.equals(uint256(sequence).uintToString(0)), "Receipt proof is for a different instruction");
        require(receipt.assetId.equals(instruction.assetId), "Receipt asset differs from the planned one");
        require(keccak256(bytes(receipt.assetType)) == hashAssetType(instruction.assetType), "Receipt asset type differs from the planned one");
        require(receipt.quantity.equals(instruction.amount), "Receipt quantity differs from the planned one");
        if (bytes(instruction.source).length > 0) {
            require(receipt.sourceFinId.equals(instruction.source), "Receipt source differs from the planned one");
        }
        if (bytes(instruction.destination).length > 0) {
            require(receipt.destinationFinId.equals(instruction.destination), "Receipt destination differs from the planned one");
        }
        return recoverReceiptProofSigner(receipt, signature);
    }

    /// @dev The signed intent must cover the instruction's movement: matching
    ///      leg (by asset), amount and a direction the intent authorizes. As in
    ///      the v1 operator, the trade phase is not part of the signed message,
    ///      so both phase directions of the asset leg are acceptable.
    function intentMatchesInstruction(
        Instruction calldata instruction,
        SignaturePayload calldata payload
    ) public pure returns (bool) {
        bool destinationEmpty = bytes(instruction.destination).length == 0;
        if (
            instruction.assetId.equals(payload.asset.assetId) &&
            instruction.assetType == payload.asset.assetType &&
            instruction.amount.equals(payload.asset.amount)
        ) {
            // asset leg: seller -> buyer (initiate) or buyer -> seller (close)
            if (instruction.source.equals(payload.sellerFinId) &&
                (destinationEmpty || instruction.destination.equals(payload.buyerFinId))) {
                return true;
            }
            if (instruction.source.equals(payload.buyerFinId) &&
                (destinationEmpty || instruction.destination.equals(payload.sellerFinId))) {
                return true;
            }
        }
        if (
            instruction.assetId.equals(payload.settlement.assetId) &&
            instruction.assetType == payload.settlement.assetType
        ) {
            if (payload.eip712PrimaryType == PrimaryType.LOAN) {
                // settlement leg of a loan: amount decides the direction
                if (instruction.amount.equals(payload.loan.borrowedMoneyAmount) &&
                    instruction.source.equals(payload.buyerFinId) &&
                    (destinationEmpty || instruction.destination.equals(payload.sellerFinId))) {
                    return true;
                }
                if (instruction.amount.equals(payload.loan.returnedMoneyAmount) &&
                    instruction.source.equals(payload.sellerFinId) &&
                    (destinationEmpty || instruction.destination.equals(payload.buyerFinId))) {
                    return true;
                }
            } else if (
                instruction.amount.equals(payload.settlement.amount) &&
                instruction.source.equals(payload.buyerFinId) &&
                (destinationEmpty || instruction.destination.equals(payload.sellerFinId))
            ) {
                // settlement leg: buyer -> seller
                return true;
            }
        }
        return false;
    }
}
