// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ERC20WithOperator.sol";
import "../../utils/finp2p/IFinP2PAsset.sol";
import "../../utils/finp2p/IFinP2PEscrow.sol";
import "../../utils/finp2p/Signature.sol";
import "../../utils/finp2p/Bytes.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "../../utils/finp2p/FinP2PTypedVerifier.sol";

/**
 * @dev FINP2POperatorERC20
 *
 * This contract implements the FINP2P protocol operations for ERC20 tokens.
 * It allows to associate and remove assets, issue, transfer and redeem tokens.
 * It also allows to hold and release tokens in escrow.
 *
 */
contract FINP2POperatorERC20 is IFinP2PAsset, IFinP2PEscrow, AccessControl, FinP2PSignatureVerifier {

    bytes32 private constant ASSET_MANAGER = keccak256("ASSET_MANAGER");
    bytes32 private constant TRANSACTION_MANAGER = keccak256("TRANSACTION_MANAGER");

    struct Asset {
        string id;
        address tokenAddress;
    }

    struct Lock {
        string assetId;
        string finId;
        address token;
        uint256 amount;
    }

    mapping(string => Asset) assets;
    mapping(bytes16 => Lock) private locks;
    uint8 private hashType;

    constructor(uint8 _hashType) {
        hashType = _hashType;
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ASSET_MANAGER, _msgSender());
        _grantRole(TRANSACTION_MANAGER, _msgSender());
    }

    function getHashType() public view returns (uint8) {
        return hashType;
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

    function issueWithoutSignature(
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

    function issue(
        string memory nonce,
        string memory assetId,
        string memory buyerFinId,
        string memory issuerFinId,
        uint256 quantity,
        string memory settlementAsset,
        uint256 settlementAmount,
        bytes memory signature
    ) public override virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to issue asset");
        require(haveAsset(assetId), "Asset not found");

        address buyer = Bytes.finIdToAddress(buyerFinId);
        address issuer = Bytes.finIdToAddress(issuerFinId);

        require(verifyPrimarySaleSignature(
            nonce,
            buyerFinId,
            issuerFinId,
            assetId,
            quantity,
            settlementAsset,
            settlementAmount,
            buyer,
            hashType,
            signature
        ), "Signature is not verified");

        Asset memory asset = assets[assetId];
        ERC20WithOperator(asset.tokenAddress).mint(issuer, quantity);

        emit Issue(assetId, issuerFinId, quantity);
    }

    function transfer(
        string memory nonce,
        string memory assetId,
        string memory sellerFinId,
        string memory buyerFinId,
        uint256 quantity,
        string memory settlementAsset,
        uint256 settlementAmount,
        bytes memory signature
    ) public override virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to transfer asset");
        require(haveAsset(assetId), "Asset not found");

        address seller = Bytes.finIdToAddress(sellerFinId);
        address buyer = Bytes.finIdToAddress(buyerFinId);

        require(verifySecondarySaleSignature(
            nonce,
            sellerFinId,
            buyerFinId,
            assetId,
            quantity,
            settlementAsset,
            settlementAmount,
            seller,
            hashType,
            signature
        ), "Signature is not verified");

        Asset memory asset = assets[assetId];
        uint256 balance = IERC20(asset.tokenAddress).balanceOf(seller);
        require(balance >= quantity, "Not sufficient balance to transfer");

        IERC20(asset.tokenAddress).transferFrom(seller, buyer, quantity);

        emit Transfer(assetId, sellerFinId, buyerFinId, quantity);
    }

    function redeem(
        string memory nonce,
        string memory assetId,
        string memory ownerFinId,
        string memory buyerFinId,
        uint256 quantity,
        string memory settlementAsset,
        uint256 settlementAmount,
        bytes memory signature
    ) public override virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to redeem asset");
        require(haveAsset(assetId), "Asset not found");
        require(quantity > 0, "Amount should be greater than zero");

        address owner = Bytes.finIdToAddress(ownerFinId);

        require(verifyRedemptionSignature(
            nonce,
            ownerFinId,
            buyerFinId,
            assetId,
            quantity,
            settlementAsset,
            settlementAmount,
            owner,
            hashType,
            signature
        ), "Signature is not verified");

        Asset memory asset = assets[assetId];
        uint256 balance = IERC20(asset.tokenAddress).balanceOf(owner);
        require(balance >= quantity, "Not sufficient balance to redeem");

        ERC20WithOperator(asset.tokenAddress).burnFrom(owner, quantity);

        emit Redeem(assetId, ownerFinId, quantity);
    }

    function hold(
        bytes16 operationId,
        string memory nonce,
        string memory assetId,
        string memory sellerFinId,
        string memory buyerFinId,
        uint256 quantity,
        string memory settlementAsset,
        uint256 settlementAmount,
        bytes memory signature
    ) public override virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to hold asset");

        address buyer = Bytes.finIdToAddress(buyerFinId);

        require(verifySecondarySaleSignature(
            nonce,
            sellerFinId,
            buyerFinId,
            assetId,
            quantity,
            settlementAsset,
            settlementAmount,
            buyer,
            hashType,
            signature
        ), "Signature is not verified");

        require(settlementAmount > 0, "Amount should be greater than zero");
        require(haveAsset(settlementAsset), "Asset not found");
        Asset memory asset = assets[settlementAsset];

        uint256 balance = IERC20(asset.tokenAddress).balanceOf(buyer);
        require(balance >= settlementAmount, "Not sufficient balance to hold");

        if (haveContract(operationId))
            revert("Contract already exists");

        if (!IERC20(asset.tokenAddress).transferFrom(buyer, address(this), settlementAmount))
            revert("Transfer failed");

        locks[operationId] = Lock(
            settlementAsset,
            buyerFinId,
            asset.tokenAddress,
            settlementAmount
        );

        emit Hold(settlementAsset, buyerFinId, settlementAmount, operationId);
    }

    function getLockInfo(bytes16 operationId) public override view returns (LockInfo memory) {
        require(haveContract(operationId), "Contract not found");
        Lock storage l = locks[operationId];
        return LockInfo(l.assetId, l.amount);
    }

    function release(
        bytes16 operationId,
        string memory sellerFinId
    ) public override virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");

        require(haveContract(operationId), "Contract does not exists");

        Lock storage lock = locks[operationId];

        uint256 balance = IERC20(lock.token).balanceOf(address(this));
        require(balance >= lock.amount, "No tokens to release");

        address seller = Bytes.finIdToAddress(sellerFinId);

        IERC20(lock.token).transfer(seller, lock.amount);

        emit Release(lock.assetId, lock.finId, sellerFinId, lock.amount, operationId);

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