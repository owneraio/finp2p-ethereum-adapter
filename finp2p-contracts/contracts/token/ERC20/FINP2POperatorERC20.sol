// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../../utils/erc20/Burnable.sol";
import "../../utils/erc20/Mintable.sol";
import "../../utils/finp2p/Bytes.sol";
import "../../utils/finp2p/FinP2PSignatureVerifier.sol";
import "../../utils/finp2p/Signature.sol";
import "../../utils/StringUtils.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @dev FINP2POperatorERC20
 *
 * This contract implements the FINP2P protocol operations for ERC20 tokens.
 * It allows to associate and remove assets, issue, transfer and redeem tokens.
 * It also allows to hold and release tokens in escrow.
 *
 */
contract FINP2POperatorERC20 is AccessControl, FinP2PSignatureVerifier {
    using StringUtils for string;
    using StringUtils for uint256;

    bytes32 private constant ASSET_MANAGER = keccak256("ASSET_MANAGER");
    bytes32 private constant TRANSACTION_MANAGER = keccak256("TRANSACTION_MANAGER");

    struct LockInfo {
        string assetId;
        string finId;
        string amount;
    }

    event Issue(string assetId, string issuerFinId, string quantity);
    event Transfer(string assetId, string sourceFinId, string destinationFinId, string quantity);
    event Hold(string assetId, string finId, string quantity, bytes16 operationId);
    event Release(string assetId, string sourceFinId, string destinationFinId, string quantity, bytes16 operationId);
    event Redeem(string assetId, string ownerFinId, string quantity, bytes16 operationId);
    event Rollback(string assetId, string finId, string quantity, bytes16 operationId);

    struct Asset {
        string id;
        address tokenAddress;
    }

    struct Lock {
        string assetId;
        string finId;
        uint256 amount;
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

    function associateAsset(string memory assetId, address tokenAddress) public {
        require(hasRole(ASSET_MANAGER, _msgSender()), "FINP2POperatorERC20: must have asset manager role to associate asset");
        require(!haveAsset(assetId), "Asset already exists");
        assets[assetId] = Asset(assetId, tokenAddress);
    }

    function removeAsset(string memory assetId) public  {
        require(hasRole(ASSET_MANAGER, _msgSender()), "FINP2POperatorERC20: must have asset manager role to remove asset");
        require(haveAsset(assetId), "Asset not found");
        delete assets[assetId];
    }

    function getAssetAddress(string memory assetId) public  view returns (address) {
        require(haveAsset(assetId), "Asset not found");
        Asset memory asset = assets[assetId];
        return asset.tokenAddress;
    }

    function getBalance(
        string memory assetId,
        string memory finId
    ) public  view returns (string memory) {
        require(haveAsset(assetId), "Asset not found");
        address addr = Bytes.finIdToAddress(finId);
        Asset memory asset = assets[assetId];
        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenBalance = IERC20(asset.tokenAddress).balanceOf(addr);
        return tokenBalance.uintToString(tokenDecimals);
    }

    function issue(
        string memory assetId,
        string memory issuerFinId,
        string memory quantity
    ) public virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to issue asset");
        require(haveAsset(assetId), "Asset not found");

        address issuer = Bytes.finIdToAddress(issuerFinId);

        Asset memory asset = assets[assetId];
        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        Mintable(asset.tokenAddress).mint(issuer, tokenAmount);

        emit Issue(assetId, issuerFinId, quantity);
    }

    function transfer(
        string memory nonce,
        string memory sellerFinId,
        string memory buyerFinId,
        Term memory assetTerm,
        Term memory settlementTerm,
        uint8 eip712PrimaryType,
        bytes memory signature
    ) public virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to transfer asset");
        require(haveAsset(assetTerm.assetId), "Asset not found");

        address seller = Bytes.finIdToAddress(sellerFinId);
        address buyer = Bytes.finIdToAddress(buyerFinId);

        require(verifyTransferSignature(
            nonce,
            buyerFinId,
            sellerFinId,
            assetTerm,
            settlementTerm,
            seller,
            eip712PrimaryType,
            signature
        ), "Signature is not verified");

        Asset memory asset = assets[assetTerm.assetId];

        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenAmount = assetTerm.amount.stringToUint(tokenDecimals);
        uint256 balance = IERC20(asset.tokenAddress).balanceOf(seller);
        require(balance >= tokenAmount, "Not sufficient balance to transfer");

        IERC20(asset.tokenAddress).transferFrom(seller, buyer, tokenAmount);

        emit Transfer(assetTerm.assetId, sellerFinId, buyerFinId, assetTerm.amount);
    }

    function hold(
        bytes16 operationId,
        string memory nonce,
        string memory sellerFinId,
        string memory buyerFinId,
        Term memory assetTerm,
        Term memory settlementTerm,
        uint8 eip712PrimaryType,
        bytes memory signature
    ) public virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to hold asset");
        require(haveAsset(assetTerm.assetId), "Asset not found");
        require(!haveContract(operationId), "Withheld contract already exists");

        uint256 tokenAmount = getTokenAmount(assets[assetTerm.assetId].tokenAddress, assetTerm.amount);

        address seller = Bytes.finIdToAddress(sellerFinId);

        require(verifyTransferSignature(
            nonce,
            buyerFinId,
            sellerFinId,
            assetTerm,
            settlementTerm,
            seller,
            eip712PrimaryType,
            signature
        ), "Signature is not verified");


        if (!IERC20(assets[assetTerm.assetId].tokenAddress).transferFrom(seller, address(this), tokenAmount))
            revert("Transfer failed");

        locks[operationId] = Lock(
            assetTerm.assetId,
            sellerFinId,
            tokenAmount
        );

        emit Hold(assetTerm.assetId, sellerFinId, assetTerm.amount, operationId);
    }

    function release(bytes16 operationId, string memory buyerFinId, string  memory quantity) public virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");
        require(haveContract(operationId), "Contract does not exists");

        Lock storage lock = locks[operationId];
        require(haveAsset(lock.assetId), "Asset not found");
        Asset memory asset = assets[lock.assetId];
        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        require(tokenAmount == lock.amount, "Release quantity does not match held quantity");

        uint256 balance = IERC20(asset.tokenAddress).balanceOf(address(this));
        require(balance >= lock.amount, "No tokens to release");

        address buyer = Bytes.finIdToAddress(buyerFinId);

        IERC20(asset.tokenAddress).transfer(buyer, lock.amount);

        emit Release(lock.assetId, lock.finId, buyerFinId, quantity, operationId);

        delete locks[operationId];
    }

    function redeem(bytes16 operationId, string memory ownerFinId, string memory quantity) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");
        require(haveContract(operationId), "Contract does not exists");

        Lock storage lock = locks[operationId];
        require(haveAsset(lock.assetId), "Asset not found");
        Asset memory asset = assets[lock.assetId];
        require(lock.finId.equals(ownerFinId), "Trying to redeem asset with owner different from the one who held it");
        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        require(tokenAmount == lock.amount, "Redeem quantity does not match held quantity");

        uint256 balance = IERC20(asset.tokenAddress).balanceOf(address(this));
        require(balance >= lock.amount, "No tokens to redeem");

        Burnable(asset.tokenAddress).burn(address(this), lock.amount);

        emit Redeem(lock.assetId, ownerFinId,  quantity, operationId);

        delete locks[operationId];
    }

    function rollback(
        bytes16 operationId
    ) public virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to rollback asset");

        require(haveContract(operationId), "contract does not exists");
        Lock storage lock = locks[operationId];
        address owner = Bytes.finIdToAddress(lock.finId);
        require(msg.sender == owner, "Only owner may unhold the contract");

        Asset memory asset = assets[lock.assetId];

        uint256 totalBalance = IERC20(asset.tokenAddress).balanceOf(address(this));
        require(totalBalance >= lock.amount, "No tokens to unhold");

        IERC20(asset.tokenAddress).transferFrom(address(this), owner, lock.amount);

        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        string memory amount = lock.amount.uintToString(tokenDecimals);
        emit Rollback(lock.assetId, lock.finId, amount, operationId);

        delete locks[operationId];
    }

    function getTokenAmount(address tokenAddress, string memory amount) internal view returns (uint256) {
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        return amount.stringToUint(tokenDecimals);
    }

    function getLockInfo(bytes16 operationId) public view returns (LockInfo memory) {
        require(haveContract(operationId), "Contract not found");
        Lock storage l = locks[operationId];
        Asset memory asset = assets[l.assetId];
        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        string memory amount = l.amount.uintToString(tokenDecimals);
        return LockInfo(l.assetId, l.finId,amount);
    }

    function haveAsset(string memory assetId) internal view returns (bool exists) {
        exists = (assets[assetId].tokenAddress != address(0));
    }

    function haveContract(bytes16 operationId) internal view returns (bool exists) {
        exists = (locks[operationId].amount > 0);
    }

}