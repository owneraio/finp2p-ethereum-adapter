// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Burnable} from "../../utils/erc20/Burnable.sol";
import {FinP2P} from "../../utils/finp2p/FinP2P.sol";
import {FinIdUtils} from "../../utils/finp2p/FinIdUtils.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Mintable} from "../../utils/erc20/Mintable.sol";
import {StringUtils} from "../../utils/StringUtils.sol";
import {ExecutionContextManager} from "../../utils/finp2p/ExecutionContextManager.sol";

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
    using StringUtils for uint8;
    using FinIdUtils for string;

    string public constant VERSION = "0.23.4";

    bytes32 private constant ASSET_MANAGER = keccak256("ASSET_MANAGER");
    bytes32 private constant TRANSACTION_MANAGER = keccak256("TRANSACTION_MANAGER");

    address private escrowWalletAddress;
    ExecutionContextManager private executionContextManager;
    mapping(string => FinP2P.Asset) private assets;
    mapping(string => FinP2P.Lock) private locks;

    constructor(address executionContextAddress) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ASSET_MANAGER, _msgSender());
        _grantRole(TRANSACTION_MANAGER, _msgSender());
        executionContextManager = ExecutionContextManager(executionContextAddress);
    }

    /// @notice Grant the asset manager role to an account
    /// @param account The account to grant the role
    function grantAssetManagerRole(address account) external {
        if (!hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) revert FinP2P.NotAdmin();
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

    function getExecutionContextManager() external returns (address) {
        return address(executionContextManager);
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

    function issue(
        string calldata destination,
        string calldata assetId,
        FinP2P.AssetType assetType,
        string calldata quantity
    ) external onlyRole(TRANSACTION_MANAGER) {
        _mint(destination.toAddress(), assetId, quantity);
        emit FinP2P.Issue(assetId, assetType, destination, quantity, FinP2P.ExecutionContext("", 0));
    }


    function redeem(
        string calldata source,
        string calldata assetId,
        FinP2P.AssetType assetType,
        string calldata quantity
    ) external onlyRole(TRANSACTION_MANAGER) {
        _burn(source.toAddress(), assetId, quantity);
        emit FinP2P.Redeem(assetId, assetType, source, quantity, '', FinP2P.ExecutionContext("", 0));
    }


    function issueWithContext(
        string calldata destination,
        string calldata assetId,
        FinP2P.AssetType assetType,
        string calldata quantity,
        FinP2P.ExecutionContext memory executionContext
    ) external onlyRole(TRANSACTION_MANAGER) {
        executionContextManager.validateCurrentInstruction(executionContext,
            FinP2P.InstructionType.ISSUE, FinP2P.InstructionExecutor.THIS_CONTRACT,
            "", destination, assetId, assetType, quantity);
        _mint(destination.toAddress(), assetId, quantity);
        executionContextManager.completeCurrentInstruction(executionContext.planId);
        emit FinP2P.Issue(assetId, assetType, destination, quantity, executionContext);
    }

    function transferWithContext(
        string calldata source,
        string calldata destination,
        string calldata assetId,
        FinP2P.AssetType assetType,
        string calldata quantity,
        FinP2P.ExecutionContext memory executionContext
    ) external onlyRole(TRANSACTION_MANAGER) {
        executionContextManager.validateCurrentInstruction(executionContext,
            FinP2P.InstructionType.TRANSFER, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, destination, assetId, assetType, quantity);
        _transfer(source.toAddress(), destination.toAddress(), assetId, quantity);
        executionContextManager.completeCurrentInstruction(executionContext.planId);
        emit FinP2P.Transfer(assetId, assetType, source, destination, quantity, executionContext);
    }

    function redeemWithContext(
        string calldata source,
        string calldata assetId,
        FinP2P.AssetType assetType,
        string calldata quantity,
        FinP2P.ExecutionContext memory executionContext
    ) external onlyRole(TRANSACTION_MANAGER) {
        executionContextManager.validateCurrentInstruction(executionContext,
            FinP2P.InstructionType.REDEEM, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, "", assetId, assetType, quantity);

        _burn(source.toAddress(), assetId, quantity);
        executionContextManager.completeCurrentInstruction(executionContext.planId);
        emit FinP2P.Redeem(assetId, assetType, source, quantity, '', executionContext);
    }

    function holdWithContext(
        string memory source,
        string memory destination,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory quantity,
        string memory operationId,
        FinP2P.ExecutionContext calldata executionContext
    ) external onlyRole(TRANSACTION_MANAGER) {
        executionContextManager.validateCurrentInstruction(executionContext,
            FinP2P.InstructionType.HOLD, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, destination, assetId, assetType, quantity);

        _transfer(source.toAddress(), _getEscrow(), assetId, quantity);
        locks[operationId] = FinP2P.Lock(assetId, assetType, source, destination, quantity);
        executionContextManager.completeCurrentInstruction(executionContext.planId);
        emit FinP2P.Hold(assetId, assetType, source, quantity, operationId, executionContext);
    }

    function releaseToWithContext(
        string memory source,
        string memory destination,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory quantity,
        string memory operationId,
        FinP2P.ExecutionContext memory executionContext
    ) external onlyRole(TRANSACTION_MANAGER) {
        executionContextManager.validateCurrentInstruction(executionContext,
            FinP2P.InstructionType.RELEASE, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, destination, assetId, assetType, quantity);

        require(_haveContract(operationId), "Contract does not exists");
        FinP2P.Lock storage lock = locks[operationId];
        require(lock.amount.equals(quantity), "Trying to release amount different from the one held");
        require(lock.destination.equals(destination), "Trying to release to different destination than the one expected in the lock");

        _transfer(_getEscrow(), destination.toAddress(), lock.assetId, lock.amount);
        executionContextManager.completeCurrentInstruction(executionContext.planId);

        emit FinP2P.Release(lock.assetId, lock.assetType, lock.source, lock.destination, quantity, operationId, executionContext);
        delete locks[operationId];
    }

    function releaseAndRedeemWithContext(
        string memory source,
        string memory assetId,
        FinP2P.AssetType assetType,
        string memory quantity,
        string memory operationId,
        FinP2P.ExecutionContext memory executionContext
    ) external onlyRole(TRANSACTION_MANAGER) {
        executionContextManager.validateCurrentInstruction(executionContext,
            FinP2P.InstructionType.RELEASE, FinP2P.InstructionExecutor.THIS_CONTRACT,
            source, "", assetId, assetType, quantity);

        require(_haveContract(operationId), "Contract does not exists");
        FinP2P.Lock storage lock = locks[operationId];
        require(lock.source.equals(source), "Trying to redeem asset with owner different from the one who held it");
        require(bytes(lock.destination).length == 0, "Trying to redeem asset with non-empty destination");
        require(lock.amount.equals(quantity), "Trying to redeem amount different from the one held");
        _burn(_getEscrow(), lock.assetId, lock.amount);
        executionContextManager.completeCurrentInstruction(executionContext.planId);
        emit FinP2P.Redeem(lock.assetId, lock.assetType, source, quantity, operationId, executionContext);
        delete locks[operationId];
    }

    // TODO: should be a part of execution context to with a failure proof provided
    /// @notice Release asset from escrow back to the source
    /// @param operationId The operation id of the withheld asset
    function releaseBack(
        string memory operationId
    ) external onlyRole(TRANSACTION_MANAGER) {
        require(_haveContract(operationId), "contract does not exists");
        FinP2P.Lock storage lock = locks[operationId];
        _transfer(_getEscrow(), lock.source.toAddress(), lock.assetId, lock.amount);
        emit FinP2P.Release(lock.assetId, lock.assetType, lock.source, "", lock.amount, operationId, FinP2P.ExecutionContext("", 0));
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

    // ------------------------------------------------------------------------------------------

    function _haveAsset(string memory assetId) internal view returns (bool exists) {
        exists = (assets[assetId].tokenAddress != address(0));
    }

    function _haveContract(string memory operationId) internal view returns (bool exists) {
        exists = (bytes(locks[operationId].amount).length > 0);
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