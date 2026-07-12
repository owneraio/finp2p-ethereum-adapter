// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../utils/StringUtils.sol";
import {Burnable} from "../utils/erc20/Burnable.sol";
import {Mintable} from "../utils/erc20/Mintable.sol";
import {FinP2PReceiptVerifier} from "../utils/finp2p/FinP2PReceiptVerifier.sol";
import {FinP2PSignatureVerifier} from "../utils/finp2p/FinP2PSignatureVerifier.sol";
import {FinP2PEscrow} from "./FinP2PEscrow.sol";
import {FinP2PPlanVerifier} from "./FinP2PPlanVerifier.sol";
import {ProofSignerRegistry} from "./ProofSignerRegistry.sol";
import "./PlanTypes.sol";

/**
 * @dev FINP2POrchestrator
 *
 * Plan-based FinP2P operator (v2): the EVM projection of a FinP2P execution
 * plan, structurally aligned with the Canton adapter's OrchestrationPlan
 * (on-/off-ledger venues, execution states, per-org approvals) but with
 * guarantees only an EVM contract can enforce:
 *  - all required investor EIP-712 investment signatures are verified once, at
 *    plan creation; execution calls carry no signatures;
 *  - instructions run strictly in sequence, tracked by an internal cursor
 *    (total order — not just among off-ledger instructions);
 *  - on-ledger instructions advance the cursor atomically with the token
 *    operation;
 *  - off-ledger instructions advance only via completeOffLedgerInstruction
 *    with an EIP-712 receipt proof verified against the executing
 *    organization's registered proof signers — cryptographic attestation, not
 *    a trusted-provider assertion.
 *
 * Escrow is external (FinP2PEscrow), shared with direct-mode flows. Signature
 * verification (investor intents and receipt proofs) is delegated to an
 * external stateless FinP2PPlanVerifier: it keeps this contract under the
 * EIP-170 bytecode limit and lets several operators share one verifier.
 */
contract FINP2POrchestrator is ProofSignerRegistry {
    using StringUtils for string;
    using StringUtils for uint256;

    string public constant VERSION = "2.0.0";

    bytes32 private constant TRANSACTION_MANAGER = keccak256("TRANSACTION_MANAGER");
    uint8 private constant MAX_INSTRUCTIONS = 50;

    event PlanCreated(string planId, uint8 instructionCount);
    event InstructionExecuted(string planId, uint8 sequence, InstructionType instructionType);
    event OffLedgerInstructionCompleted(string planId, uint8 sequence, address proofSigner, string transactionId);
    event PlanCompleted(string planId);
    event PlanRejected(string planId, string reason);
    event PlanReverted(string planId);
    event PlanApprovalRecorded(string planId, string orgId, ApprovalState state);

    /// @notice Domain events, same shapes as the v1 operator (receipt parsing)
    event Issue(string assetId, FinP2PSignatureVerifier.AssetType assetType, string issuerFinId, string quantity);
    event Transfer(string assetId, FinP2PSignatureVerifier.AssetType assetType, string sourceFinId, string destinationFinId, string quantity);
    event Hold(string assetId, FinP2PSignatureVerifier.AssetType assetType, string finId, string quantity, string operationId);
    event Release(string assetId, FinP2PSignatureVerifier.AssetType assetType, string sourceFinId, string destinationFinId, string quantity, string operationId);
    event Redeem(string assetId, FinP2PSignatureVerifier.AssetType assetType, string ownerFinId, string quantity, string operationId);

    FinP2PEscrow private immutable escrow;
    FinP2PPlanVerifier private immutable verifier;

    mapping(string => address) private assetTokens;
    mapping(string => address) private credentials;

    mapping(bytes32 => OrchestrationPlan) private plans;
    mapping(bytes32 => mapping(uint8 => Instruction)) private planInstructions;
    // per-org plan approvals (Canton: OrgApproval); keyed by planKey => keccak(orgId)
    mapping(bytes32 => mapping(bytes32 => ApprovalState)) private planApprovals;
    // investor signatures are chain- and contract-agnostic (fixed FinP2P domain),
    // so replay across plans is blocked explicitly; keyed by keccak(digest, signer)
    mapping(bytes32 => bool) private usedInvestorIntents;

    constructor(address admin, address escrowAddress, address verifierAddress) {
        require(escrowAddress != address(0), "Escrow cannot be zero");
        require(verifierAddress != address(0), "Verifier cannot be zero");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ASSET_MANAGER, admin);
        _grantRole(TRANSACTION_MANAGER, admin);
        escrow = FinP2PEscrow(escrowAddress);
        verifier = FinP2PPlanVerifier(verifierAddress);
    }

    function getVersion() external pure returns (string memory) {
        return VERSION;
    }

    function getEscrowAddress() external view returns (address) {
        return address(escrow);
    }

    function getVerifierAddress() external view returns (address) {
        return address(verifier);
    }

    // ---- Role management ----

    function grantAssetManagerRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(ASSET_MANAGER, account);
    }

    function grantTransactionManagerRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(TRANSACTION_MANAGER, account);
    }

    // ---- Credential management ----

    function addCredential(string calldata finId, address addr) external onlyRole(ASSET_MANAGER) {
        require(addr != address(0), "Wallet address cannot be zero");
        credentials[finId] = addr;
    }

    function removeCredential(string calldata finId) external onlyRole(ASSET_MANAGER) {
        require(credentials[finId] != address(0), "Credential not found");
        delete credentials[finId];
    }

    function getCredentialAddress(string calldata finId) external view returns (address) {
        require(credentials[finId] != address(0), "Credential not found");
        return credentials[finId];
    }

    // ---- Asset management ----

    function associateAsset(string calldata assetId, address tokenAddress) external onlyRole(ASSET_MANAGER) {
        require(assetTokens[assetId] == address(0), "Asset already exists");
        require(tokenAddress != address(0), "Token address cannot be zero");
        assetTokens[assetId] = tokenAddress;
    }

    function removeAsset(string calldata assetId) external onlyRole(ASSET_MANAGER) {
        require(assetTokens[assetId] != address(0), "Asset not found");
        delete assetTokens[assetId];
    }

    function getAssetAddress(string calldata assetId) external view returns (address) {
        return _assetToken(assetId);
    }

    // ---- Plan lifecycle ----

    /// @notice Mirror a FinP2P execution plan on-chain. All investor signatures are
    ///         verified here, once; they are never stored and execution calls do not
    ///         take signatures.
    function createPlan(
        string calldata planId,
        Instruction[] calldata instructions,
        SignaturePayload[] calldata signatures
    ) external onlyRole(TRANSACTION_MANAGER) {
        bytes32 planKey = _planKey(planId);
        require(plans[planKey].status == PlanStatus.NONE, "Plan already exists");
        require(instructions.length > 0, "Plan has no instructions");
        require(instructions.length <= MAX_INSTRUCTIONS, "Too many instructions");

        for (uint256 i = 0; i < signatures.length; i++) {
            _verifyInvestorSignature(signatures[i]);
        }

        for (uint256 i = 0; i < instructions.length; i++) {
            Instruction calldata instruction = instructions[i];
            require(instruction.sequence == i + 1, "Non-contiguous sequences");
            _validateInstruction(instruction, signatures);
            planInstructions[planKey][instruction.sequence] = instruction;
            planInstructions[planKey][instruction.sequence].state = ExecutionState.PENDING;
        }
        // terminal escrow instructions must be linked to this plan's own holds
        verifier.validatePlanStructure(instructions);

        plans[planKey] = OrchestrationPlan(PlanStatus.PENDING, uint8(instructions.length), 1);
        emit PlanCreated(planId, uint8(instructions.length));
    }

    /// @notice Record an organization's stance on a plan (Canton: ApprovePlan).
    ///         Informational/audit record: plan progression is enforced by the
    ///         cursor and proofs, not by approval quorum (the router owns that).
    function recordPlanApproval(
        string calldata planId,
        string calldata orgId,
        ApprovalState state
    ) external onlyRole(TRANSACTION_MANAGER) {
        bytes32 planKey = _planKey(planId);
        require(plans[planKey].status != PlanStatus.NONE, "Plan not found");
        planApprovals[planKey][keccak256(bytes(orgId))] = state;
        emit PlanApprovalRecorded(planId, orgId, state);
    }

    function getPlanApproval(string calldata planId, string calldata orgId) external view returns (ApprovalState) {
        return planApprovals[_planKey(planId)][keccak256(bytes(orgId))];
    }

    /// @notice Execute the current on-ledger instruction of a plan. No signatures:
    ///         investor consent was verified at plan creation, ordering is
    ///         enforced by the cursor. The token operation and the plan-state
    ///         update are atomic (Canton: Orchestrator choices + updatePlanInstruction).
    function executeInstruction(string calldata planId, uint8 sequence) external onlyRole(TRANSACTION_MANAGER) {
        (OrchestrationPlan storage plan, Instruction storage instruction) = _currentInstruction(planId, sequence);
        require(instruction.venue == ExecutionVenue.ON_LEDGER, "Instruction is off-ledger");

        _performInstruction(instruction);

        instruction.state = ExecutionState.COMPLETED;
        emit InstructionExecuted(planId, sequence, instruction.instructionType);
        _advanceCursor(planId, plan, sequence);
    }

    /// @notice Complete an off-ledger instruction (Canton: UpdateOffLedgerInstruction) —
    ///         but with cryptographic attestation instead of a trusted-provider
    ///         assertion: an EIP-712 receipt proof signed by a registered proof
    ///         signer of the executing organization, bound to this plan,
    ///         sequence, asset and amount. Permissionless: the proof is
    ///         self-authenticating.
    function completeOffLedgerInstruction(
        string calldata planId,
        uint8 sequence,
        FinP2PReceiptVerifier.ReceiptProof calldata receipt,
        bytes calldata signature
    ) external {
        (OrchestrationPlan storage plan, Instruction storage instruction) = _currentInstruction(planId, sequence);
        require(instruction.venue == ExecutionVenue.OFF_LEDGER, "Instruction is on-ledger");

        address signer = verifier.verifyReceiptProof(receipt, instruction, planId, sequence, signature);
        require(isProofSigner(instruction.organizationId, signer), "Unregistered proof signer");

        instruction.state = ExecutionState.COMPLETED;
        emit OffLedgerInstructionCompleted(planId, sequence, signer, receipt.transactionId);
        _advanceCursor(planId, plan, sequence);
    }

    /// @notice Reject a plan that cannot proceed. Cursor stops; only revertPlan may follow.
    function rejectPlan(string calldata planId, string calldata reason) external onlyRole(TRANSACTION_MANAGER) {
        OrchestrationPlan storage plan = plans[_planKey(planId)];
        require(plan.status == PlanStatus.PENDING, "Plan is not active");
        plan.status = PlanStatus.REJECTED;
        emit PlanRejected(planId, reason);
    }

    /// @notice Compensate a rejected plan: roll back escrow holds this contract executed.
    ///         Completed transfers/issues/redeems and off-ledger instructions are not
    ///         auto-reversed; in FinP2P those reversals are new plans.
    function revertPlan(string calldata planId) external onlyRole(TRANSACTION_MANAGER) {
        bytes32 planKey = _planKey(planId);
        OrchestrationPlan storage plan = plans[planKey];
        require(plan.status == PlanStatus.REJECTED, "Plan is not rejected");

        for (uint8 seq = plan.instructionCount; seq >= 1; seq--) {
            Instruction storage instruction = planInstructions[planKey][seq];
            if (
                instruction.state == ExecutionState.COMPLETED &&
                instruction.venue == ExecutionVenue.ON_LEDGER &&
                instruction.instructionType == InstructionType.HOLD &&
                escrow.hasHold(instruction.operationId)
            ) {
                escrow.rollback(instruction.operationId);
                instruction.state = ExecutionState.REJECTED;
                emit Release(instruction.assetId, instruction.assetType, instruction.source, "", instruction.amount, instruction.operationId);
            }
            if (seq == 1) break;
        }

        plan.status = PlanStatus.REVERTED;
        emit PlanReverted(planId);
    }

    function getPlan(string calldata planId) external view returns (OrchestrationPlan memory) {
        OrchestrationPlan memory plan = plans[_planKey(planId)];
        require(plan.status != PlanStatus.NONE, "Plan not found");
        return plan;
    }

    function hasPlan(string calldata planId) external view returns (bool) {
        return plans[_planKey(planId)].status != PlanStatus.NONE;
    }

    function getInstruction(string calldata planId, uint8 sequence) external view returns (Instruction memory) {
        bytes32 planKey = _planKey(planId);
        require(plans[planKey].status != PlanStatus.NONE, "Plan not found");
        require(sequence >= 1 && sequence <= plans[planKey].instructionCount, "Invalid instruction sequence");
        return planInstructions[planKey][sequence];
    }

    // ---- Plan internals ----

    function _currentInstruction(
        string calldata planId,
        uint8 sequence
    ) private view returns (OrchestrationPlan storage plan, Instruction storage instruction) {
        bytes32 planKey = _planKey(planId);
        plan = plans[planKey];
        require(plan.status == PlanStatus.PENDING, "Plan is not active");
        require(sequence == plan.currentSequence, "Not the current instruction");
        instruction = planInstructions[planKey][sequence];
    }

    /// @dev Advance past the completed instruction, auto-completing any
    ///      consecutive AWAITs on the way (an idea carried over from the
    ///      earlier orchestration attempt, PR #46): awaits are pure sequencing
    ///      no-ops, so completing them inline saves a transaction per await.
    function _advanceCursor(string calldata planId, OrchestrationPlan storage plan, uint8 sequence) private {
        bytes32 planKey = _planKey(planId);
        uint8 next = sequence + 1;
        while (
            next <= plan.instructionCount &&
            planInstructions[planKey][next].instructionType == InstructionType.AWAIT
        ) {
            planInstructions[planKey][next].state = ExecutionState.COMPLETED;
            emit InstructionExecuted(planId, next, InstructionType.AWAIT);
            next++;
        }
        if (next > plan.instructionCount) {
            plan.status = PlanStatus.COMPLETED;
            emit PlanCompleted(planId);
        } else {
            plan.currentSequence = next;
        }
    }

    function _verifyInvestorSignature(SignaturePayload calldata payload) private {
        (bool valid, bytes32 digest) = verifier.verifySignaturePayload(payload);
        require(valid, "Invalid investor signature");
        // keyed by signed digest + signer, not signature bytes: the same
        // signature has several valid encodings (64/65 bytes)
        bytes32 intentKey = keccak256(abi.encode(digest, keccak256(bytes(payload.signerFinId))));
        require(!usedInvestorIntents[intentKey], "Investor signature already used");
        usedInvestorIntents[intentKey] = true;
    }

    function _validateInstruction(Instruction calldata instruction, SignaturePayload[] calldata signatures) private view {
        if (instruction.venue == ExecutionVenue.OFF_LEDGER) {
            // an await has no receipt to prove; off-ledger it would deadlock the cursor
            require(instruction.instructionType != InstructionType.AWAIT, "Await must be on-ledger");
            require(bytes(instruction.organizationId).length > 0, "Missing executing organization");
            require(hasProofSigners(instruction.organizationId), "No proof signers registered");
        }
        // per-type field requirements apply to BOTH venues — an off-ledger
        // instruction with empty planned fields would weaken the receipt-proof
        // binding into a source/destination wildcard
        verifier.validateInstruction(instruction, signatures);
    }

    function _performInstruction(Instruction storage instruction) private {
        InstructionType instructionType = instruction.instructionType;
        if (instructionType == InstructionType.ISSUE) {
            _mint(_resolveAddress(instruction.destination), instruction.assetId, instruction.amount);
            emit Issue(instruction.assetId, instruction.assetType, instruction.destination, instruction.amount);
        } else if (instructionType == InstructionType.TRANSFER) {
            _transfer(_resolveAddress(instruction.source), _resolveAddress(instruction.destination), instruction.assetId, instruction.amount);
            emit Transfer(instruction.assetId, instruction.assetType, instruction.source, instruction.destination, instruction.amount);
        } else if (instructionType == InstructionType.HOLD) {
            address tokenAddress = _assetToken(instruction.assetId);
            address destination = bytes(instruction.destination).length > 0
                ? _resolveAddress(instruction.destination)
                : address(0);
            escrow.deposit(
                instruction.operationId,
                tokenAddress,
                _resolveAddress(instruction.source),
                destination,
                _toTokenAmount(tokenAddress, instruction.amount)
            );
            emit Hold(instruction.assetId, instruction.assetType, instruction.source, instruction.amount, instruction.operationId);
        } else if (instructionType == InstructionType.RELEASE) {
            _requireHoldMatches(instruction);
            escrow.release(instruction.operationId, _resolveAddress(instruction.destination));
            emit Release(instruction.assetId, instruction.assetType, instruction.source, instruction.destination, instruction.amount, instruction.operationId);
        } else if (instructionType == InstructionType.RELEASE_AND_REDEEM) {
            _requireHoldMatches(instruction);
            escrow.releaseAndBurn(instruction.operationId);
            emit Redeem(instruction.assetId, instruction.assetType, instruction.source, instruction.amount, instruction.operationId);
        } else if (instructionType == InstructionType.REDEEM) {
            _burn(_resolveAddress(instruction.source), instruction.assetId, instruction.amount);
            emit Redeem(instruction.assetId, instruction.assetType, instruction.source, instruction.amount, "");
        } else if (instructionType == InstructionType.REVERT_HOLD) {
            _requireHoldMatches(instruction);
            escrow.rollback(instruction.operationId);
            emit Release(instruction.assetId, instruction.assetType, instruction.source, "", instruction.amount, instruction.operationId);
        } else if (instructionType == InstructionType.AWAIT) {
            // no token operation; kept on-chain to preserve sequence alignment with the orchestrator
        } else {
            revert("Unsupported instruction type");
        }
    }

    /// @dev The escrow releases/burns/rolls back the STORED hold, while events
    ///      report the instruction's fields. Bind token, amount and source so a
    ///      terminal instruction can never move a hold its receipt does not
    ///      describe (destination pinning is enforced by the escrow itself).
    ///      Plan ownership of the hold is established at creation time by
    ///      validatePlanStructure + the escrow's duplicate-operationId rejection.
    function _requireHoldMatches(Instruction storage instruction) private view {
        FinP2PEscrow.Hold memory hold = escrow.getHold(instruction.operationId);
        require(
            hold.token == _assetToken(instruction.assetId) &&
            hold.amount == _toTokenAmount(hold.token, instruction.amount) &&
            hold.source == _resolveAddress(instruction.source),
            "Hold mismatch"
        );
    }

    // ---- Token internals ----

    function _assetToken(string memory assetId) private view returns (address tokenAddress) {
        tokenAddress = assetTokens[assetId];
        require(tokenAddress != address(0), "Asset not found");
    }

    function _resolveAddress(string memory finId) private view returns (address) {
        address addr = credentials[finId];
        require(addr != address(0), "Credential not found for finId");
        return addr;
    }

    function _toTokenAmount(address tokenAddress, string memory quantity) private view returns (uint256) {
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        return quantity.stringToUint(tokenDecimals);
    }

    function _mint(address to, string memory assetId, string memory quantity) private {
        address tokenAddress = _assetToken(assetId);
        Mintable(tokenAddress).mint(to, _toTokenAmount(tokenAddress, quantity));
    }

    function _transfer(address from, address to, string memory assetId, string memory quantity) private {
        address tokenAddress = _assetToken(assetId);
        uint256 tokenAmount = _toTokenAmount(tokenAddress, quantity);
        require(IERC20(tokenAddress).balanceOf(from) >= tokenAmount, "Insufficient balance");
        IERC20(tokenAddress).transferFrom(from, to, tokenAmount);
    }

    function _burn(address from, string memory assetId, string memory quantity) private {
        address tokenAddress = _assetToken(assetId);
        uint256 tokenAmount = _toTokenAmount(tokenAddress, quantity);
        require(IERC20(tokenAddress).balanceOf(from) >= tokenAmount, "Insufficient balance");
        Burnable(tokenAddress).burnFrom(from, tokenAmount);
    }

    function _planKey(string calldata planId) private pure returns (bytes32) {
        return keccak256(bytes(planId));
    }
}
