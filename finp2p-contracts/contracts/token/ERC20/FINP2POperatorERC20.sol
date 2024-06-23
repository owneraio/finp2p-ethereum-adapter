// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ERC20WithOperator.sol";
import "../../utils/finp2p/IFinP2PAsset.sol";
import "../../utils/finp2p/IFinP2PEscrow.sol";
import "../../utils/finp2p/Signature.sol";
import "../../utils/finp2p/Bytes.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @dev FINP2POperatorERC20
 *
 * This contract implements the FINP2P protocol operations for ERC20 tokens.
 * It allows to associate and remove assets, issue, transfer and redeem tokens.
 * It also allows to hold and release tokens in escrow.
 *
 */
contract FINP2POperatorERC20 is IFinP2PAsset, IFinP2PEscrow, AccessControl {

    bytes32 private constant ASSET_MANAGER = keccak256("ASSET_MANAGER");
    bytes32 private constant TRANSACTION_MANAGER = keccak256("TRANSACTION_MANAGER");
    bytes16 public constant OPERATION_ID_ZERO_VALUE = 0x00000000000000000000000000000000;

    struct Asset {
        string id;
        address tokenAddress;
    }

    struct Lock {
        string assetId;
        string finId;
        address token;
        uint256 amount;
        uint256 expiry;
    }

    mapping(string => Asset) assets;
    mapping(bytes16 => Lock) private locks;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ASSET_MANAGER, _msgSender());
        _grantRole(TRANSACTION_MANAGER, _msgSender());
    }

    function grantAssetManagerRole(address account) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperatorERC20: must have admin role to grant asset manager role");
        grantRole(ASSET_MANAGER, account);
    }

    function grantTransactionManagerRole(address account) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperatorERC20: must have admin role to grant transaction manager role");
        grantRole(TRANSACTION_MANAGER, account);
    }

    function associateAsset(string memory assetId, address tokenAddress) public override {
        require(hasRole(ASSET_MANAGER, _msgSender()), "FINP2POperatorERC20: must have asset manager role to associate asset");
        require(!haveAsset(assetId), "Asset already exists");
        assets[assetId] = Asset(assetId, tokenAddress);
    }

    function removeAsset(string memory assetId) public override {
        require(hasRole(ASSET_MANAGER, _msgSender()), "FINP2POperatorERC20: must have asset manager role to remove asset");
        require(haveAsset(assetId), "Asset not found");
        delete assets[assetId];
    }

    function getAssetAddress(string memory assetId) public override view returns (address) {
        require(haveAsset(assetId), "Asset not found");
        Asset memory asset = assets[assetId];
        return asset.tokenAddress;
    }

    function getBalance(
        string memory assetId,
        string memory finId
    ) public override view returns (uint256) {
        require(haveAsset(assetId), "Asset not found");
        address addr = Bytes.finIdToAddress(finId);
        Asset memory asset = assets[assetId];
        return IERC20(asset.tokenAddress).balanceOf(addr);
    }

    function issue(
        string memory assetId,
        string memory issuerFinId,
        uint256 quantity
    ) public override virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to issue asset");
        require(haveAsset(assetId), "Asset not found");

        address issuer = Bytes.finIdToAddress(issuerFinId);

        Asset memory asset = assets[assetId];
        ERC20WithOperator(asset.tokenAddress).mint(issuer, quantity);

        emit Issue(assetId, issuerFinId, quantity);
    }

    function transfer(
        bytes32 nonce,
        string memory assetId,
        string memory sourceFinId,
        string memory destinationFinId,
        uint256 quantity,
        bytes32 settlementHash,
        bytes32 hash,
        bytes memory signature
    ) public override virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to transfer asset");
        require(haveAsset(assetId), "Asset not found");

        require(Signature.isTransferHashValid(
                nonce,
                assetId,
                sourceFinId,
                destinationFinId,
                quantity,
                settlementHash,
                hash
            ), "Hash is not valid for transfer");

        address source = Bytes.finIdToAddress(sourceFinId);
        address destination = Bytes.finIdToAddress(destinationFinId);

        require(Signature.verify(
                source,
                hash,
                signature
            ),
            "Signature is not verified");

        Asset memory asset = assets[assetId];
        uint256 balance = IERC20(asset.tokenAddress).balanceOf(source);
        require(balance >= quantity, "Not sufficient balance to transfer");

        IERC20(asset.tokenAddress).transferFrom(source, destination, quantity);

        emit Transfer(assetId, sourceFinId, destinationFinId, quantity);
    }

    function redeem(
        bytes16 operationId,
        bytes32 nonce,
        string memory assetId,
        string memory account,
        uint256 quantity,
        bytes32 settlementHash,
        bytes32 hash,
        bytes memory signature
    ) public override virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to redeem asset");
        require(haveAsset(assetId), "Asset not found");
        require(quantity > 0, "Amount should be greater than zero");
        require(Signature.isRedeemHashValid(
                nonce,
                assetId,
                account,
                quantity,
                settlementHash,
                hash
            ), "Hash is not valid for redeem");

        address issuer = Bytes.finIdToAddress(account);

        require(Signature.verify(
                issuer,
                hash,
                signature
            ),
            "Signature is not verified");

        Asset memory asset = assets[assetId];
        uint256 balance = IERC20(asset.tokenAddress).balanceOf(issuer);
        if (operationId == OPERATION_ID_ZERO_VALUE) {
           require(balance >= quantity, "Not sufficient balance to redeem");
           ERC20WithOperator(asset.tokenAddress).burnFrom(issuer, quantity);
           emit Redeem(assetId, account, quantity, operationId);
        } else {
           require(haveContract(operationId), "Contract does not exists");
           Lock storage lock = locks[operationId];
           require(quantity == lock.amount, "Amount to redeem is not equal to locked amount for this operationId");
           ERC20WithOperator(asset.tokenAddress).burnFrom(address(this), quantity);
           delete locks[operationId];
           emit Redeem(assetId, account, quantity, operationId);
        }
    }

    function hold(
        bytes16 operationId,
        string memory assetId,
        string memory sourceFinId,
        string memory destinationFinId,
        uint256 quantity,
        uint256 expiry,
        bytes32 assetHash,
        string memory assetType,
        bytes32 hash,
        bytes memory signature
    ) public override virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to hold asset");

        require(Signature.isHoldHashValid(
                assetId,
                sourceFinId,
                destinationFinId,
                quantity,
                expiry,
                assetHash,
                assetType,
                hash
            ), "Hash is not valid for hold");

        address owner = Bytes.finIdToAddress(sourceFinId);

        require(Signature.verify(
                owner,
                hash,
                signature
            ),
            "Signature is not verified");

        require(expiry > block.timestamp, "Expiration time is before current time");
        require(quantity > 0, "Amount should be greater than zero");
        require(haveAsset(assetId), "Asset not found");
        Asset memory asset = assets[assetId];

        // uint256 balance = IERC20(asset.tokenAddress).balanceOf(owner);
        require(IERC20(asset.tokenAddress).balanceOf(owner) >= quantity, "Not sufficient balance to hold");

        if (haveContract(operationId))
            revert("Contract already exists");

        if (!IERC20(asset.tokenAddress).transferFrom(owner, address(this), quantity))
            revert("Transfer failed");

        locks[operationId] = Lock(
            assetId,
            sourceFinId,
            asset.tokenAddress,
            quantity,
            expiry
        );

        emit Hold(assetId, sourceFinId, quantity, operationId);
    }

    function getLockInfo(bytes16 operationId) public override view returns (LockInfo memory) {
        require(haveContract(operationId), "Contract not found");
        Lock storage l = locks[operationId];
        return LockInfo(l.assetId, l.amount, l.expiry);
    }

    function release(
        bytes16 operationId,
        string memory destinationFinId
    ) public override virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");

        require(haveContract(operationId), "Contract does not exists");

        Lock storage lock = locks[operationId];

        uint256 balance = IERC20(lock.token).balanceOf(address(this));
        require(balance >= lock.amount, "No tokens to release");

        address destination = Bytes.finIdToAddress(destinationFinId);

        IERC20(lock.token).transfer(destination, lock.amount);

        emit Release(lock.assetId, lock.finId, destinationFinId, lock.amount, operationId);

        delete locks[operationId];
    }

    function rollback(
        bytes16 operationId
    ) public override virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to rollback asset");

        require(haveContract(operationId), "contract does not exists");
        Lock storage lock = locks[operationId];
        address owner = Bytes.finIdToAddress(lock.finId);
        require(msg.sender == owner, "Only owner may unhold the contract");

        require(block.timestamp >= lock.expiry, "Current time is before expiration time");

        uint256 totalBalance = IERC20(lock.token).balanceOf(address(this));
        require(totalBalance >= lock.amount, "No tokens to unhold");

        IERC20(lock.token).transferFrom(address(this), owner, lock.amount);

        emit Rollback(lock.assetId, lock.finId, lock.amount, operationId);

        delete locks[operationId];
    }


    function haveAsset(string memory assetId) internal view returns (bool exists) {
        exists = (assets[assetId].tokenAddress != address(0));
    }

    function haveContract(bytes16 operationId) internal view returns (bool exists) {
        exists = (locks[operationId].amount > 0);
    }

}