// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../utils/StringUtils.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AssetRegistry} from "../utils/finp2p/registry/AssetRegistry.sol";
import {AssetStandard} from "../utils/finp2p/registry/AssetStandard.sol";
import {FinIdUtils} from "../utils/finp2p/FinIdUtils.sol";
import {FinP2PSignatureVerifier} from "../utils/finp2p/verify/FinP2PSignatureVerifier.sol";
import {OrchestrationManager} from "../utils/finp2p/orchestration/OrchestrationManager.sol";
import {FinP2P} from "../utils/finp2p/FinP2P.sol";
/**
 * @dev FINP2POperatorERC20
 *
 * This contract implements the FINP2P protocol operations for ERC20 tokens.
 * It allows to associate and remove assets, issue, transfer and redeem tokens.
 * It also allows to hold and release tokens in escrow.
 *
 */
contract FINP2POperator is AccessControl, FinP2PSignatureVerifier {
    using StringUtils for string;
    using FinIdUtils for string;

    string public constant VERSION = "0.26.0-ep";

    bytes32 private constant ASSET_MANAGER = keccak256("ASSET_MANAGER");
    bytes32 private constant TRANSACTION_MANAGER = keccak256("TRANSACTION_MANAGER");

    OrchestrationManager private orchestration;

    address private escrowWalletAddress;
    mapping(string => FinP2P.Asset) private assets;
    mapping(string => FinP2P.Lock) private locks;
    address private assetRegistry;
    address private orchestrationManager;

    constructor(address admin, address _assetRegistry, address _orchestrationManager) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ASSET_MANAGER, admin);
        _grantRole(TRANSACTION_MANAGER, admin);
        assetRegistry = _assetRegistry;
        orchestrationManager = _orchestrationManager;
    }

    function getVersion() external pure returns (string memory) {
        return VERSION;
    }

    function getAssetRegistry() external view returns (address) {
        return assetRegistry;
    }

    /// @notice Grant the asset manager role to an account
    /// @param account The account to grant the role
    function grantAssetManagerRole(address account) onlyRole(DEFAULT_ADMIN_ROLE) external {
        grantRole(ASSET_MANAGER, account);
    }

    /// @notice Grant the transaction manager role to an account
    /// @param account The account to grant the role
    function grantTransactionManagerRole(address account) onlyRole(DEFAULT_ADMIN_ROLE) external {
        grantRole(TRANSACTION_MANAGER, account);
    }

    /// @notice Set escrow wallet address
    /// @param _escrowWalletAddress The escrow wallet address
    function setEscrowWalletAddress(address _escrowWalletAddress) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperatorERC20: must have admin role to set escrow wallet address");
        escrowWalletAddress = _escrowWalletAddress;
    }

    function getOrchestrationManager() external view returns (address) {
        return orchestrationManager;
    }

    /// @notice Associate an asset with a token address
    /// @param assetId The asset id
    /// @param tokenAddress The token address
    function associateAsset(string calldata assetId, address tokenAddress, bytes32 assetStandard) onlyRole(ASSET_MANAGER) external {
        require(!_haveAsset(assetId), "Asset already exists");
        require(tokenAddress != address(0), "Token address cannot be zero");

        address standardAddress = AssetRegistry(assetRegistry).getAssetStandard(assetStandard);
        require(standardAddress != address(0), "Asset standard not found");

        assets[assetId] = FinP2P.Asset(assetId, assetStandard, tokenAddress);
    }

    /// @notice Remove an asset
    /// @param assetId The asset id
    function removeAsset(string calldata assetId) onlyRole(ASSET_MANAGER) external {
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
        AssetStandard standard = AssetStandard(AssetRegistry(assetRegistry).getAssetStandard(asset.standard));
        return standard.balanceOf(asset.tokenAddress, addr);
    }

    function issue(
        string calldata issuerFinId,
        FinP2P.Term calldata assetTerm,
        FinP2P.OperationParams memory op
    ) external onlyRole(TRANSACTION_MANAGER) {
        OrchestrationManager orchestration = OrchestrationManager(orchestrationManager);
        orchestration.validateCurrentInstruction(op.exCtx,
            FinP2P.InstructionType.ISSUE, FinP2P.InstructionExecutor.THIS_CONTRACT,
            "", issuerFinId, assetTerm);
        _mint(issuerFinId.toAddress(), assetTerm.assetId, assetTerm.amount, op);
        orchestration.completeCurrentInstruction(op.exCtx.planId);
//         todo: in case of a failure, fail execution with a reason
//        execution.failCurrentInstruction(executionContext.planId, "failed");
        emit FinP2P.Issue(assetTerm.assetId, assetTerm.assetType, issuerFinId, assetTerm.amount, op.exCtx);
    }

    function transfer(
        string calldata source,
        string calldata destination,
        FinP2P.Term calldata assetTerm,
        FinP2P.OperationParams memory op
    ) external onlyRole(TRANSACTION_MANAGER) {
        OrchestrationManager orchestration = OrchestrationManager(orchestrationManager);
        orchestration.validateCurrentInstruction(op.exCtx,
            FinP2P.InstructionType.TRANSFER, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, destination, assetTerm);
        _transfer(source.toAddress(), destination.toAddress(), assetTerm.assetId, assetTerm.amount, op);
        orchestration.completeCurrentInstruction(op.exCtx.planId);
        emit FinP2P.Transfer(assetTerm.assetId, assetTerm.assetType, source,
            destination, assetTerm.amount, op.exCtx);
    }

    function redeem(
        string calldata source,
        FinP2P.Term calldata assetTerm,
        FinP2P.OperationParams memory op
    ) external onlyRole(TRANSACTION_MANAGER) {
        OrchestrationManager orchestration = OrchestrationManager(orchestrationManager);
        orchestration.validateCurrentInstruction(op.exCtx,
            FinP2P.InstructionType.REDEEM, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, "", assetTerm);

        _burn(source.toAddress(), assetTerm.assetId, assetTerm.amount, op);
        orchestration.completeCurrentInstruction(op.exCtx.planId);
        emit FinP2P.Redeem(assetTerm.assetId, assetTerm.assetType, source, assetTerm.amount, '', op.exCtx);
    }

    function hold(
        string memory source,
        string memory destination,
        FinP2P.Term calldata assetTerm,
        FinP2P.OperationParams memory op
    ) external onlyRole(TRANSACTION_MANAGER) {
        OrchestrationManager orchestration = OrchestrationManager(orchestrationManager);
        orchestration.validateCurrentInstruction(op.exCtx,
            FinP2P.InstructionType.HOLD, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, destination, assetTerm);

        _transfer(source.toAddress(), _getEscrow(), assetTerm.assetId, assetTerm.amount, op);
        locks[op.operationId] = FinP2P.Lock(assetTerm.assetId, assetTerm.assetType, source, destination, assetTerm.amount);
        orchestration.completeCurrentInstruction(op.exCtx.planId);
        emit FinP2P.Hold(assetTerm.assetId, assetTerm.assetType, source, assetTerm.amount, op.operationId, op.exCtx);
    }

    function releaseTo(
        string memory source,
        string memory destination,
        FinP2P.Term calldata assetTerm,
        FinP2P.OperationParams memory op
    ) external onlyRole(TRANSACTION_MANAGER) {
        OrchestrationManager orchestration = OrchestrationManager(orchestrationManager);
        orchestration.validateCurrentInstruction(op.exCtx,
            FinP2P.InstructionType.RELEASE, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, destination, assetTerm);

        require(_haveContract(op.operationId), "Contract does not exists");
        FinP2P.Lock storage lock = locks[op.operationId];
        require(lock.amount.equals(assetTerm.amount), "Trying to release amount different from the one held");
        require(lock.destination.equals(destination), "Trying to release to different destination than the one expected in the lock");

        _transfer(_getEscrow(), destination.toAddress(), lock.assetId, lock.amount, op);
        orchestration.completeCurrentInstruction(op.exCtx.planId);

        emit FinP2P.Release(lock.assetId, lock.assetType, lock.source,
            lock.destination, assetTerm.amount, op.operationId, op.exCtx);
        delete locks[op.operationId];
    }

    function releaseAndRedeem(
        string memory source,
        FinP2P.Term calldata assetTerm,
        FinP2P.OperationParams memory op
    ) external onlyRole(TRANSACTION_MANAGER) {
        OrchestrationManager orchestration = OrchestrationManager(orchestrationManager);
        orchestration.validateCurrentInstruction(op.exCtx,
            FinP2P.InstructionType.RELEASE, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, "", assetTerm);

        require(_haveContract(op.operationId), "Contract does not exists");
        FinP2P.Lock storage lock = locks[op.operationId];
        require(lock.source.equals(source), "Trying to redeem asset with owner different from the one who held it");
        require(bytes(lock.destination).length == 0, "Trying to redeem asset with non-empty destination");
        require(lock.amount.equals(assetTerm.amount), "Trying to redeem amount different from the one held");
        _burn(_getEscrow(), lock.assetId, lock.amount, op);
        orchestration.completeCurrentInstruction(op.exCtx.planId);
        emit FinP2P.Redeem(lock.assetId, lock.assetType, source,
            assetTerm.amount, op.operationId, op.exCtx);
        delete locks[op.operationId];
    }

    /// @notice Get the lock info
    /// @param operationId The operation id
    /// @return The lock info
    function getLockInfo(string memory operationId) external view returns (FinP2P.LockInfo memory) {
        require(_haveContract(operationId), "Contract not found");
        FinP2P.Lock storage l = locks[operationId];
        return FinP2P.LockInfo(l.assetId, l.assetType, l.source, l.destination, l.amount);
    }

    // ------------------------------------------------------------------------------------------

    function _haveAsset(string memory assetId) internal view returns (bool exists) {
        exists = (assets[assetId].tokenAddress != address(0));
    }

    function _haveContract(string memory operationId) internal view returns (bool exists) {
        exists = (bytes(locks[operationId].amount).length > 0);
    }

    function _mint(address to, string memory assetId, string memory quantity, FinP2P.OperationParams memory op) internal {
        require(_haveAsset(assetId), "Asset not found");
        FinP2P.Asset memory asset = assets[assetId];
        AssetStandard standard = AssetStandard(AssetRegistry(assetRegistry).getAssetStandard(asset.standard));
        standard.mint(asset.tokenAddress, to, quantity, op);
    }

    function _transfer(address from, address to, string memory assetId, string memory quantity, FinP2P.OperationParams memory op) internal {
        require(_haveAsset(assetId), "Asset not found");
        FinP2P.Asset memory asset = assets[assetId];
        AssetStandard standard = AssetStandard(AssetRegistry(assetRegistry).getAssetStandard(asset.standard));
        standard.transferFrom(asset.tokenAddress, from, to, quantity, op);
    }

    function _hold(address from, string memory assetId, string memory quantity, FinP2P.OperationParams memory op) internal {
        require(_haveAsset(assetId), "Asset not found");
        FinP2P.Asset memory asset = assets[assetId];
        AssetStandard standard = AssetStandard(AssetRegistry(assetRegistry).getAssetStandard(asset.standard));
        standard.transferFrom(asset.tokenAddress, from, address(standard), quantity, op);
    }

    function _release(address to, string memory assetId, string memory quantity, FinP2P.OperationParams memory op) internal {
        require(_haveAsset(assetId), "Asset not found");
        FinP2P.Asset memory asset = assets[assetId];
        AssetStandard standard = AssetStandard(AssetRegistry(assetRegistry).getAssetStandard(asset.standard));
        standard.transferFrom(asset.tokenAddress, address(standard), to, quantity, op);
    }

    function _burn(address from, string memory assetId, string memory quantity, FinP2P.OperationParams memory op) internal {
        require(_haveAsset(assetId), "Asset not found");
        FinP2P.Asset memory asset = assets[assetId];
        AssetStandard standard = AssetStandard(AssetRegistry(assetRegistry).getAssetStandard(asset.standard));
        standard.burn(asset.tokenAddress, from, quantity, op);
    }

    function _releaseBurn(string memory assetId, string memory quantity, FinP2P.OperationParams memory op) internal {
        require(_haveAsset(assetId), "Asset not found");
        FinP2P.Asset memory asset = assets[assetId];
        AssetStandard standard = AssetStandard(AssetRegistry(assetRegistry).getAssetStandard(asset.standard));
        standard.burn(asset.tokenAddress, address(standard), quantity, op);
    }

    function _getEscrow() public view returns (address) {
        if (escrowWalletAddress == address(0)) {
            return address(this);
        } else {
            return escrowWalletAddress;
        }
    }
}
