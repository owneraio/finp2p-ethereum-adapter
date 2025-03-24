// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Burnable} from "../../utils/erc20/Burnable.sol";
import {FinP2P} from "../../utils/finp2p/FinP2P.sol";
import {FinIdUtils} from "../../utils/finp2p/FinIdUtils.sol";
import {FinP2PSignatureVerifier} from "../../utils/finp2p/FinP2PSignatureVerifier.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Mintable} from "../../utils/erc20/Mintable.sol";
import {StringUtils} from "../../utils/StringUtils.sol";

/**
 * @dev FINP2POperatorERC20
 *
 * This contract implements the FINP2P protocol operations for ERC20 tokens.
 * It allows to associate and remove assets, issue, transfer and redeem tokens.
 * It also allows to hold and release tokens in escrow.
 *
 */
contract FINP2POperatorERC20 is AccessControl {

    using StringUtils for string;
    using StringUtils for uint256;
    using FinIdUtils for string;
    using FinP2P for FinP2P.InstructionType;

    string public constant VERSION = "0.23.4";

    bytes32 private constant ASSET_MANAGER = keccak256("ASSET_MANAGER");
    bytes32 private constant TRANSACTION_MANAGER = keccak256("TRANSACTION_MANAGER");

    FinP2PSignatureVerifier private verifier;
    address private escrowWalletAddress;
    mapping(string => FinP2P.Asset) private assets;
    mapping(string => FinP2P.Lock) private locks;
    mapping(string => FinP2P.ExecutionContext) private executions;

    constructor(address verifierAddress) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ASSET_MANAGER, _msgSender());
        _grantRole(TRANSACTION_MANAGER, _msgSender());
        verifier = FinP2PSignatureVerifier(verifierAddress);
    }

    /// @notice Grant the asset manager role to an account
    /// @param account The account to grant the role
    function grantAssetManagerRole(address account) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperatorERC20: must have admin role to grant asset manager role");
        grantRole(ASSET_MANAGER, account);
    }

    /// @notice Grant the transaction manager role to an account
    /// @param account The account to grant the role
    function grantTransactionManagerRole(address account) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperatorERC20: must have admin role to grant transaction manager role");
        grantRole(TRANSACTION_MANAGER, account);
    }

    /// @notice Set escrow wallet address
    /// @param _escrowWalletAddress The escrow wallet address
    function setEscrowWalletAddress(address _escrowWalletAddress) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperatorERC20: must have admin role to set escrow wallet address");
        escrowWalletAddress = _escrowWalletAddress;
    }

    /// @notice Associate an asset with a token address
    /// @param assetId The asset id
    /// @param tokenAddress The token address
    function associateAsset(string calldata assetId, address tokenAddress) external {
        require(hasRole(ASSET_MANAGER, _msgSender()), "FINP2POperatorERC20: must have asset manager role to associate asset");
        require(!_haveAsset(assetId), "Asset already exists");
        assets[assetId] = FinP2P.Asset(assetId, tokenAddress);
    }

    /// @notice Remove an asset
    /// @param assetId The asset id
    function removeAsset(string calldata assetId) external {
        require(hasRole(ASSET_MANAGER, _msgSender()), "FINP2POperatorERC20: must have asset manager role to remove asset");
        require(_haveAsset(assetId), "Asset not found");
        delete assets[assetId];
    }

    /// @notice Get the token address of an asset
    /// @param assetId The asset id
    /// @return The token address
    function getAssetAddress(string calldata assetId) external view returns (address) {
        require(_haveAsset(assetId), "Asset not found");
        FinP2P.Asset memory asset = assets[assetId];
        return asset.tokenAddress;
    }

    /// @notice Get the balance of an asset for a FinID
    /// @param assetId The asset id
    /// @param finId The FinID
    /// @return The balance of the asset
    function getBalance(
        string calldata assetId,
        string calldata finId
    ) external view returns (string memory) {
        require(_haveAsset(assetId), "Asset not found");
        address addr = finId.toAddress();
        FinP2P.Asset memory asset = assets[assetId];
        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenBalance = IERC20(asset.tokenAddress).balanceOf(addr);
        return tokenBalance.uintToString(tokenDecimals);
    }

    function createExecutionContext(string memory id) external {
        executions[id].id = id;
        executions[id].status = FinP2P.ExecutionStatus.CREATED;
        executions[id].currentInstruction = 1;
    }

    function addInstructionToExecution(
        string memory executionId,
        uint8 instructionSequence,
        FinP2P.InstructionType instructionType,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory source,
        string memory destination,
        string memory amount,
        FinP2P.InstructionExecutor executor,
        string memory proofSigner
    ) external {
        require(executions[executionId].status == FinP2P.ExecutionStatus.CREATED, "Execution is not in CREATED status");
        FinP2P.InstructionStatus status;
        if (executor == FinP2P.InstructionExecutor.THIS_CONTRACT && instructionType.requireInvestorSignature()) {
            status = FinP2P.InstructionStatus.REQUIRE_INVESTOR_SIGNATURE;
        } else {
            status = FinP2P.InstructionStatus.PENDING;
        }
        executions[executionId].instructions.push(FinP2P.Instruction(instructionSequence, instructionType,
            assetId, assetType, source, destination, amount,
            executor, status, proofSigner));
    }

    function provideInvestorSignature(
        string calldata executionId,
        uint8 instructionSequence,
        FinP2P.Domain memory domain,
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        FinP2P.Term memory asset,
        FinP2P.Term memory settlement,
        FinP2P.LoanTerm memory loan,
        bytes memory signature
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to transfer asset");
        require(executions[executionId].status == FinP2P.ExecutionStatus.CREATED, "Execution is not in CREATED status");
        FinP2P.Instruction memory instruction = executions[executionId].instructions[instructionSequence - 1];
        require(instruction.executor == FinP2P.InstructionExecutor.THIS_CONTRACT, "Instruction executor is not THIS_CONTRACT");
        string memory signerFinId = instruction.source;
        require(verifier.verifyInvestmentSignature(
            executions[executionId].primaryType,
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
        executions[executionId].instructions[instructionSequence - 1].status = FinP2P.InstructionStatus.PENDING;
        if (_isExecutionVerified(executionId)) {
            executions[executionId].status = FinP2P.ExecutionStatus.VERIFIED;
        }
    }

    function issue(
        string calldata executionId,
        uint8 instructionSequence,
        string calldata destination,
        string calldata assetId,
        FinP2P.AssetType assetType,
        string calldata quantity
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to issue asset");
        _validateCurrentInstruction(executionId, instructionSequence,
            FinP2P.InstructionType.ISSUE, FinP2P.InstructionExecutor.THIS_CONTRACT,
            "", destination, assetId, assetType, quantity);
        _mint(destination.toAddress(), assetId, quantity);
        _completeCurrentInstruction(executionId);
        emit FinP2P.Issue(assetId, assetType, destination, quantity);
    }

    function transfer(
        string calldata executionId,
        uint8 instructionSequence,
        string calldata source,
        string calldata destination,
        string calldata assetId,
        FinP2P.AssetType assetType,
        string calldata quantity
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to transfer asset");
        _validateCurrentInstruction(executionId, instructionSequence,
            FinP2P.InstructionType.TRANSFER, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, destination, assetId, assetType, quantity);
        _transfer(source.toAddress(), destination.toAddress(), assetId, quantity);
        _completeCurrentInstruction(executionId);
        emit FinP2P.Transfer(assetId, assetType, source, destination, quantity);
    }

    function redeem(
        string calldata executionId,
        uint8 instructionSequence,
        string calldata source,
        string calldata assetId,
        FinP2P.AssetType assetType,
        string calldata quantity
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");
        _validateCurrentInstruction(executionId, instructionSequence,
            FinP2P.InstructionType.REDEEM, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, "", assetId, assetType, quantity);

        _burn(source.toAddress(), assetId, quantity);
        _completeCurrentInstruction(executionId);
        emit FinP2P.Redeem(assetId, assetType, source, quantity, '');
    }

    function hold(
        string memory executionId,
        uint8 instructionSequence,
        string memory source,
        string memory destination,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory quantity,
        string memory operationId
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to transfer asset");
        _validateCurrentInstruction(executionId, instructionSequence,
            FinP2P.InstructionType.HOLD, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, destination, assetId, assetType, quantity);

        _transfer(source.toAddress(), _getEscrow(), assetId, quantity);
        locks[operationId] = FinP2P.Lock(assetId, assetType, source, destination, quantity);
        _completeCurrentInstruction(executionId);
        emit FinP2P.Hold(assetId, assetType, source, quantity, operationId);
    }

    function releaseTo(
        string memory executionId,
        uint8 instructionSequence,
        string memory source,
        string memory destination,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory quantity,
        string memory operationId
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");
        _validateCurrentInstruction(executionId, instructionSequence,
            FinP2P.InstructionType.RELEASE, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, destination, assetId, assetType, quantity);

        require(_haveContract(operationId), "Contract does not exists");
        FinP2P.Lock storage lock = locks[operationId];
        require(lock.amount.equals(quantity), "Trying to release amount different from the one held");
        require(lock.destination.equals(destination), "Trying to release to different destination than the one expected in the lock");

        _transfer(_getEscrow(), destination.toAddress(), lock.assetId, lock.amount);
        _completeCurrentInstruction(executionId);

        emit FinP2P.Release(lock.assetId, lock.assetType, lock.source, lock.destination, quantity, operationId);
        delete locks[operationId];
    }

    function releaseAndRedeem(
        string memory executionId,
        uint8 instructionSequence,
        string memory source,
        string memory destination,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory quantity,
        string memory operationId
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");
        _validateCurrentInstruction(executionId, instructionSequence,
            FinP2P.InstructionType.RELEASE, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, destination, assetId, assetType, quantity);

        require(_haveContract(operationId), "Contract does not exists");
        FinP2P.Lock storage lock = locks[operationId];
        require(lock.source.equals(source), "Trying to redeem asset with owner different from the one who held it");
        require(bytes(lock.destination).length == 0, "Trying to redeem asset with non-empty destination");
        require(lock.amount.equals(quantity), "Trying to redeem amount different from the one held");
        _burn(_getEscrow(), lock.assetId, lock.amount);
        _completeCurrentInstruction(executionId);
        emit FinP2P.Redeem(lock.assetId, lock.assetType, source, quantity, operationId);
        delete locks[operationId];
    }

    /// @notice Release asset from escrow back to the source
    /// @param operationId The operation id of the withheld asset
    function releaseBack(
        string memory operationId
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to rollback asset");
        require(_haveContract(operationId), "contract does not exists");
        FinP2P.Lock storage lock = locks[operationId];
        _transfer(_getEscrow(), lock.source.toAddress(), lock.assetId, lock.amount);
        emit FinP2P.Release(lock.assetId, lock.assetType, lock.source, "", lock.amount, operationId);
        delete locks[operationId];
    }

    /// @notice Get the lock info
    /// @param operationId The operation id
    /// @return The lock info
    function getLockInfo(string memory operationId) external view returns (FinP2P.LockInfo memory) {
        require(_haveContract(operationId), "Contract not found");
        FinP2P.Lock storage l = locks[operationId];
        return FinP2P.LockInfo(l.assetId, l.assetType, l.source, l.destination, l.amount);
    }

    function provideInstructionProof(
        string calldata executionId,
        uint8 instructionSequence,
        FinP2P.Domain memory domain,
        string memory id,
        FinP2P.InstructionType instructionType,
        string memory source,
        string memory destination,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory quantity,
        bytes memory signature
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to transfer asset");
        require(executions[executionId].status == FinP2P.ExecutionStatus.VERIFIED, "Execution is not in VERIFIED status");
        _validateCurrentInstruction(executionId, instructionSequence,
            instructionType, FinP2P.InstructionExecutor.OTHER_CONTRACT,
            source, destination, assetId, assetType, quantity);
        string memory signerFinId = _getCurrentInstructionProofSigner(executionId);
        require(verifier.verifyReceiptProofSignature(domain, id, source, destination,
            assetType, assetId, quantity, signerFinId, signature
        ), "Signature is not verified");
        _completeCurrentInstruction(executionId);
    }

    // ------------------------------------------------------------------------------------------

    function _haveAsset(string memory assetId) internal view returns (bool exists) {
        exists = (assets[assetId].tokenAddress != address(0));
    }

    function _haveContract(string memory operationId) internal view returns (bool exists) {
        exists = (bytes(locks[operationId].amount).length > 0);
    }

    function _haveExecution(string memory id) internal view returns (bool exists) {
        exists = (bytes(executions[id].id).length > 0);
    }

    function _validateCurrentInstruction(
        string memory executionId,
        uint8 instructionSequence,
        FinP2P.InstructionType instructionType,
        FinP2P.InstructionExecutor instructionExecutor,
        string memory source,
        string memory destination,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory quantity
    ) internal view {
        require(_haveExecution(executionId), "Execution not found");
        require(executions[executionId].status == FinP2P.ExecutionStatus.VERIFIED, "Execution is not in VERIFIED status");
        uint8 currentInstruction = executions[executionId].currentInstruction;
        FinP2P.Instruction memory instruction = executions[executionId].instructions[currentInstruction - 1];
        require(instruction.sequence == instructionSequence, "Invalid instruction sequence");
        require(instruction.instructionType == instructionType, "Instruction type does not match");
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

    function _completeCurrentInstruction(string memory id) internal {
        require(_haveExecution(id), "Execution not found");
        uint8 currentInstruction = executions[id].currentInstruction;
        executions[id].instructions[currentInstruction - 1].status = FinP2P.InstructionStatus.EXECUTED;
        if (executions[id].instructions.length < currentInstruction) {
            executions[id].currentInstruction += 1;
        } else {
            executions[id].status = FinP2P.ExecutionStatus.EXECUTED;
        }
    }

    function _isExecutionVerified(string memory id) internal view returns (bool) {
        for (uint i = 0; i < executions[id].instructions.length; i++) {
            FinP2P.Instruction memory instruction = executions[id].instructions[i];
            if (instruction.executor == FinP2P.InstructionExecutor.THIS_CONTRACT &&
                instruction.instructionType.requireInvestorSignature() &&
                instruction.status == FinP2P.InstructionStatus.REQUIRE_INVESTOR_SIGNATURE) {
                return false;
            }
        }
        return true;
    }


    function _mint(address to, string memory assetId, string memory quantity) internal {
        require(_haveAsset(assetId), "Asset not found");
        FinP2P.Asset memory asset = assets[assetId];

        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        Mintable(asset.tokenAddress).mint(to, tokenAmount);
    }

    function _transfer(address from, address to, string memory assetId, string memory quantity) internal {
        require(_haveAsset(assetId), "Asset not found");
        FinP2P.Asset memory asset = assets[assetId];

        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        uint256 balance = IERC20(asset.tokenAddress).balanceOf(from);
        require(balance >= tokenAmount, "Not sufficient balance to transfer");

        IERC20(asset.tokenAddress).transferFrom(from, to, tokenAmount);
    }

    function _burn(address from, string memory assetId, string memory quantity) internal {
        require(_haveAsset(assetId), "Asset not found");
        FinP2P.Asset memory asset = assets[assetId];

        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        uint256 balance = IERC20(asset.tokenAddress).balanceOf(from);
        require(balance >= tokenAmount, "Not sufficient balance to burn");
        Burnable(asset.tokenAddress).burn(from, tokenAmount);
    }


    function _getEscrow() public view returns (address) {
        if (escrowWalletAddress == address(0)) {
            return address(this);
        } else {
            return escrowWalletAddress;
        }
    }
}