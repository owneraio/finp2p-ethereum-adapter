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

    uint8 public constant LEG_ASSET = 1;
    uint8 public constant LEG_SETTLEMENT = 2;

    bytes32 private constant ASSET_MANAGER = keccak256("ASSET_MANAGER");
    bytes32 private constant TRANSACTION_MANAGER = keccak256("TRANSACTION_MANAGER");

    event Issue(string assetId, string assetType, string issuerFinId, string quantity);
    event Transfer(string assetId, string assetType,  string sourceFinId, string destinationFinId, string quantity);
    event Hold(string assetId, string assetType, string finId, string quantity, bytes16 operationId);
    event Release(string assetId, string assetType, string sourceFinId, string destinationFinId, string quantity, bytes16 operationId);
    event Redeem(string assetId, string assetType, string ownerFinId, string quantity, bytes16 operationId);
    event Rollback(string assetId, string assetType, string finId, string quantity, bytes16 operationId);

    struct Asset {
        string id;
        address tokenAddress;
    }

    uint8 public constant LEG_STATUS_NONE = 0;
    uint8 public constant LEG_STATUS_WITHELD = 1;
    uint8 public constant LEG_STATUS_TRANSFERRED = 2;

    struct Leg {
        string assetId;
        string assetType;
        string finId;
        string amount;
        uint8 status;
    }

    struct DVPContext {
        Leg asset;
        Leg settlement;
    }

    address escrowWalletAddress;
    mapping(string => Asset) assets;
    mapping(bytes16 => DVPContext) private contexts;

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

    function setEscrowWalletAddress(address _escrowWalletAddress) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperatorERC20: must have admin role to set escrow wallet address");
        escrowWalletAddress = _escrowWalletAddress;
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
        string memory issuerFinId,
        Term memory assetTerm
    ) public virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to issue asset");
        _mint(Bytes.finIdToAddress(issuerFinId), assetTerm.assetId, assetTerm.amount);
        emit Issue(assetTerm.assetId, assetTerm.assetType, issuerFinId, assetTerm.amount);
    }

    function transfer(
        string memory nonce,
        string memory sellerFinId,
        string memory buyerFinId,
        Term memory assetTerm,
        Term memory settlementTerm,
        uint8 leg,
        uint8 eip712PrimaryType,
        bytes memory investorSignature
    ) public virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to transfer asset");
        if (leg == LEG_ASSET) {
            require(verifyTransferSignature(
                nonce,
                buyerFinId,
                sellerFinId,
                assetTerm,
                settlementTerm,
                Bytes.finIdToAddress(sellerFinId),
                eip712PrimaryType,
                investorSignature
            ), "Signature is not verified");
            _transfer(Bytes.finIdToAddress(sellerFinId), Bytes.finIdToAddress(buyerFinId), assetTerm.assetId, assetTerm.amount);
            emit Transfer(assetTerm.assetId, assetTerm.assetType, sellerFinId, buyerFinId, assetTerm.amount);

        } else if (leg == LEG_SETTLEMENT) {
            require(verifyTransferSignature(
                nonce,
                buyerFinId,
                sellerFinId,
                assetTerm,
                settlementTerm,
                Bytes.finIdToAddress(buyerFinId),
                eip712PrimaryType,
                investorSignature
            ), "Signature is not verified");
            _transfer(Bytes.finIdToAddress(buyerFinId), Bytes.finIdToAddress(sellerFinId), settlementTerm.assetId, settlementTerm.amount);
            emit Transfer(settlementTerm.assetId, settlementTerm.assetType, buyerFinId, sellerFinId, settlementTerm.amount);

        } else {
            revert("Invalid leg");
        }
    }

    function hold(
        bytes16 operationId,
        string memory nonce,
        string memory sellerFinId,
        string memory buyerFinId,
        Term memory assetTerm,
        Term memory settlementTerm,
        uint8 leg,
        uint8 eip712PrimaryType,
        bytes memory investorSignature
    ) public virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to hold asset");
        if (leg == LEG_ASSET) {
            require(verifyTransferSignature(
                nonce,
                buyerFinId,
                sellerFinId,
                assetTerm,
                settlementTerm,
                Bytes.finIdToAddress(sellerFinId),
                eip712PrimaryType,
                investorSignature
            ), "Signature is not verified");
            _transfer( Bytes.finIdToAddress(sellerFinId), _getEscrow(),assetTerm.assetId, assetTerm.amount);
            contexts[operationId] = DVPContext(
                Leg(assetTerm.assetId, assetTerm.assetType, sellerFinId, assetTerm.amount, LEG_STATUS_WITHELD),
                Leg(settlementTerm.assetId, settlementTerm.assetType, buyerFinId, settlementTerm.amount, LEG_STATUS_NONE)
            );
            emit Hold(assetTerm.assetId, assetTerm.assetType, sellerFinId, assetTerm.amount, operationId);

        } else if (leg == LEG_SETTLEMENT) {
            require(verifyTransferSignature(
                nonce,
                buyerFinId,
                sellerFinId,
                assetTerm,
                settlementTerm,
                Bytes.finIdToAddress(buyerFinId),
                eip712PrimaryType,
                investorSignature
            ), "Signature is not verified");
            _transfer( Bytes.finIdToAddress(buyerFinId), _getEscrow(), settlementTerm.assetId, settlementTerm.amount);
            contexts[operationId] = DVPContext(
            Leg(assetTerm.assetId, assetTerm.assetType, sellerFinId, assetTerm.amount, LEG_STATUS_NONE),
            Leg(settlementTerm.assetId, settlementTerm.assetType, buyerFinId, settlementTerm.amount, LEG_STATUS_WITHELD)
            );
            emit Hold(settlementTerm.assetId, settlementTerm.assetType, buyerFinId, settlementTerm.amount, operationId);

        } else {
            revert("Invalid leg");
        }
    }

    function release(
        bytes16 operationId,
        string memory toFinId,
        string memory quantity,
        uint8 leg
    ) public virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");
        require(haveContext(operationId), "Contract does not exists");
        DVPContext storage dvp = contexts[operationId];
        if (leg == LEG_ASSET) {
            _transfer(_getEscrow(), Bytes.finIdToAddress(toFinId), dvp.asset.assetId, dvp.asset.amount);
            emit Release(dvp.asset.assetId, dvp.asset.assetType, dvp.asset.finId, toFinId, dvp.asset.amount, operationId);
        } else if (leg == LEG_SETTLEMENT) {
            _transfer(_getEscrow(), Bytes.finIdToAddress(toFinId), dvp.settlement.assetId, dvp.settlement.amount);
            emit Release(dvp.settlement.assetId, dvp.settlement.assetType, dvp.settlement.finId, toFinId, dvp.settlement.amount, operationId);
        }
    }

    function redeem(
        bytes16 operationId,
        string memory ownerFinId,
        string memory quantity,
        uint8 leg
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");
        require(haveContext(operationId), "Contract does not exists");
        DVPContext storage dvp = contexts[operationId];
        if (leg == LEG_ASSET) {
            require(dvp.asset.finId.equals(ownerFinId), "Trying to redeem asset with owner different from the one who held it");
            _burn(_getEscrow(), dvp.asset.assetId, dvp.asset.amount);
            emit Redeem(dvp.asset.assetId, dvp.asset.assetType, ownerFinId,  dvp.asset.amount, operationId);
        } else if (leg == LEG_SETTLEMENT) {
            require(dvp.asset.finId.equals(ownerFinId), "Trying to redeem asset with owner different from the one who held it");
            _burn(_getEscrow(), dvp.settlement.assetId, dvp.settlement.amount);
            emit Redeem(dvp.settlement.assetId, dvp.settlement.assetType, ownerFinId,  dvp.settlement.amount, operationId);
        }
    }

    function rollback(
        bytes16 operationId,
        uint8 leg
    ) public virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to rollback asset");
        require(haveContext(operationId), "contract does not exists");
        DVPContext storage dvp = contexts[operationId];
        if (leg == LEG_ASSET) {
            _transfer(_getEscrow(), Bytes.finIdToAddress(dvp.asset.finId), dvp.asset.assetId, dvp.asset.amount);
            emit Rollback(dvp.asset.assetId, dvp.asset.assetType, dvp.asset.finId, dvp.asset.amount, operationId);
        } else if (leg == LEG_SETTLEMENT) {
            _transfer(_getEscrow(), Bytes.finIdToAddress(dvp.settlement.finId), dvp.settlement.assetId, dvp.settlement.amount);
            emit Rollback(dvp.asset.assetId, dvp.settlement.assetType, dvp.settlement.finId, dvp.settlement.amount, operationId);
        }
    }


    function getTokenAmount(address tokenAddress, string memory amount) internal view returns (uint256) {
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        return amount.stringToUint(tokenDecimals);
    }

//    function getDVPContext(bytes16 operationId) public view returns (DVPContext memory) {
//        require(haveContext(operationId), "Contract not found");
//        DVPContext storage dvp = contexts[operationId];
//        return LockInfo(l.assetId, l.assetType, l.finId,l.amount);
//    }

    function haveAsset(string memory assetId) internal view returns (bool exists) {
        exists = (assets[assetId].tokenAddress != address(0));
    }

    function haveContext(bytes16 operationId) internal view returns (bool exists) {
        exists = (bytes(contexts[operationId].asset.amount).length > 0);
    }

    // ------------------------------------------------------------------------------------------

    function _mint(address to, string memory assetId, string memory quantity) internal {
        require(haveAsset(assetId), "Asset not found");
        Asset memory asset = assets[assetId];

        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        Mintable(asset.tokenAddress).mint(to, tokenAmount);
    }

    function _transfer(address from, address to, string memory assetId, string memory quantity) internal {
        require(haveAsset(assetId), "Asset not found");
        Asset memory asset = assets[assetId];

        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        uint256 balance = IERC20(asset.tokenAddress).balanceOf(from);
        require(balance >= tokenAmount, "Not sufficient balance to transfer");

        IERC20(asset.tokenAddress).transferFrom(from, to, tokenAmount);
    }

    function _burn(address from, string memory assetId, string memory quantity) internal {
        require(haveAsset(assetId), "Asset not found");
        Asset memory asset = assets[assetId];

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