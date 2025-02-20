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

    uint8 public constant LEG_STATUS_CREATED = 0;
    uint8 public constant LEG_STATUS_WITHHELD = 1;
    uint8 public constant LEG_STATUS_RELEASED = 2;
    uint8 public constant LEG_STATUS_ROLLED_BACK = 3;
    uint8 public constant LEG_STATUS_TRANSFERRED = 4;

    struct Leg {
        string assetId;
        string assetType;
        string source;
        string destination;
        string amount;
        uint8 status;
        bool hasInvestorSignature;
        bytes16 operationId;
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

    function createDVDContext(
        bytes16 contextId,
        Leg memory asset,
        Leg memory settlement) public virtual {
        contexts[contextId] = DVPContext(asset,settlement);
    }

    function provideInvestorSignature(
        bytes16 contextId,
        string memory nonce,
        string memory sellerFinId,
        string memory buyerFinId,
        Term memory assetTerm,
        Term memory settlementTerm,
        uint8 eip712PrimaryType,
        uint8 leg,
        bytes memory investorSignature
    ) public virtual {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to transfer asset");
        require(haveContext(contextId), "Contract does not exists");
        address signer;
        if (leg == LEG_ASSET) {
            signer = Bytes.finIdToAddress(sellerFinId);
        } else if (leg == LEG_SETTLEMENT) {
            signer = Bytes.finIdToAddress(buyerFinId);
        } else {
            revert("Invalid leg");
        }
        require(verifyInvestorSignature(
            nonce,
            buyerFinId,
            sellerFinId,
            assetTerm,
            settlementTerm,
            signer,
            eip712PrimaryType,
            investorSignature
        ), "Signature is not verified");
        if (leg == LEG_ASSET) {
            contexts[contextId].asset.hasInvestorSignature = true;
        }  else if (leg == LEG_SETTLEMENT) {
            contexts[contextId].settlement.hasInvestorSignature = true;
        }
    }

    function issue(
        bytes16 contextId,
        uint8 legType,
        string memory toFinId,
        string memory assetId,
        string memory assetType,
        string memory quantity
    )  public virtual {
        Leg memory leg = getLeg(contextId, legType);
        require(leg.status == LEG_STATUS_CREATED, "Leg is not in created status");
        require(leg.hasInvestorSignature, "Investor signature is missing");
        require(leg.assetId.equals(assetId), "Asset id does not match");
        require(leg.assetType.equals(assetType), "Asset type does not match");
        require(leg.amount.equals(quantity), "Quantity does not match");
        require(leg.destination.equals(toFinId), "Destination does not match");

        Leg memory counterLeg = getCounterLeg(contextId, legType);
        require(counterLeg.status == LEG_STATUS_WITHHELD ||
        counterLeg.status == LEG_STATUS_TRANSFERRED, "Counter leg should be withheld or transferred");

        _mint(Bytes.finIdToAddress(toFinId), assetId, quantity);
        emit Issue(assetId, assetType, toFinId, quantity);
        leg.status = LEG_STATUS_TRANSFERRED; // TODO: will it change the value in the mapping?
    }

    function transfer(
        bytes16 contextId,
        uint8 legType,
        string memory fromFinId,
        string memory toFinId,
        string memory assetId,
        string memory assetType,
        string memory quantity
    )  public virtual {
        Leg memory leg = getLeg(contextId, legType);
        require(leg.status == LEG_STATUS_CREATED, "Leg is not in created status");
        require(leg.hasInvestorSignature, "Investor signature is missing");
        require(leg.assetId.equals(assetId), "Asset id does not match");
        require(leg.assetType.equals(assetType), "Asset type does not match");
        require(leg.amount.equals(quantity), "Quantity does not match");
        require(leg.source.equals(fromFinId), "Source does not match");
        require(leg.destination.equals(toFinId), "Destination does not match");

        Leg memory counterLeg = getCounterLeg(contextId, legType);
        require(counterLeg.status == LEG_STATUS_WITHHELD ||
                counterLeg.status == LEG_STATUS_TRANSFERRED, "Counter leg should be withheld or transferred");

        _transfer(Bytes.finIdToAddress(fromFinId), Bytes.finIdToAddress(toFinId), assetId, quantity);
        emit Transfer(assetId, assetType, fromFinId, toFinId, quantity);
        leg.status = LEG_STATUS_TRANSFERRED; // TODO: will it change the value in the mapping?
    }


    function hold(
        bytes16 contextId,
        uint8 legType,
        string memory fromFinId,
        string memory toFinId,
        string memory assetId,
        string memory assetType,
        string memory quantity,
        bytes16 operationId
    )  public virtual {
        Leg memory leg = getLeg(contextId, legType);
        require(leg.status == LEG_STATUS_CREATED, "Leg is not in created status");
        require(leg.hasInvestorSignature, "Investor signature is missing");
        require(leg.assetId.equals(assetId), "Asset id does not match");
        require(leg.assetType.equals(assetType), "Asset type does not match");
        require(leg.amount.equals(quantity), "Quantity does not match");
        require(leg.source.equals(fromFinId), "Source does not match");
        require(leg.destination.equals(toFinId), "Destination does not match");

        _transfer( Bytes.finIdToAddress(fromFinId), _getEscrow(),assetId, quantity);
        emit Hold(assetId, assetType, fromFinId, quantity, operationId);

        leg.status = LEG_STATUS_WITHHELD; // TODO: will it change the value in the mapping?
        leg.operationId = operationId;
    }

    function release(
        bytes16 contextId,
        string memory toFinId,
        string memory quantity,
        bytes16 operationId
    )  public virtual {
        Leg memory leg = getLegByOperationId(contextId, operationId);
        require(leg.status == LEG_STATUS_WITHHELD, "Leg is not in withheld status");
        require(leg.hasInvestorSignature, "Investor signature is missing");
        require(leg.amount.equals(quantity), "Quantity does not match");
        require(leg.destination.equals(toFinId), "Destination does not match");

        Leg memory counterLeg = getCounterLegByOperationId(contextId, operationId);
        require(counterLeg.status == LEG_STATUS_WITHHELD ||
        counterLeg.status == LEG_STATUS_TRANSFERRED, "Counter leg should be withheld or transferred");

        _transfer(_getEscrow(), Bytes.finIdToAddress(toFinId), leg.assetId, leg.amount);
        emit Release(leg.assetId, leg.assetType, leg.source, leg.destination, leg.amount, operationId);
        leg.status = LEG_STATUS_RELEASED; // TODO: will it change the value in the mapping?
    }

    function redeem(
        bytes16 contextId,
        string memory fromFinId,
        string memory quantity,
        bytes16 operationId
    )  public virtual {
        Leg memory leg = getLegByOperationId(contextId, operationId);
        require(leg.status == LEG_STATUS_WITHHELD, "Leg is not in withheld status");
        require(leg.hasInvestorSignature, "Investor signature is missing");
        require(leg.amount.equals(quantity), "Quantity does not match");
        require(leg.source.equals(fromFinId), "Destination does not match");

        Leg memory counterLeg = getCounterLegByOperationId(contextId, operationId);
        require(counterLeg.status == LEG_STATUS_WITHHELD ||
        counterLeg.status == LEG_STATUS_TRANSFERRED, "Counter leg should be withheld or transferred");

        _burn(_getEscrow(), leg.assetId, leg.amount);
        emit Redeem(leg.assetId, leg.assetType, fromFinId,  leg.amount, operationId);
        leg.status = LEG_STATUS_TRANSFERRED; // TODO: will it change the value in the mapping?
    }

    function rollback(
        bytes16 contextId,
        bytes16 operationId
    )  public virtual {
        Leg memory leg = getLegByOperationId(contextId, operationId);
        require(leg.status == LEG_STATUS_WITHHELD, "Leg is not in withheld status");
        require(leg.hasInvestorSignature, "Investor signature is missing");

        // Leg memory counterLeg = getCounterLegByOperationId(contextId, operationId);
        // require(counterLeg.status == LEG_STATUS_FAILED || LEG_STATUS_EXPIRED, "Counter leg should be failed or expired");

        _transfer(_getEscrow(), Bytes.finIdToAddress(leg.destination), leg.assetId, leg.amount);
        emit Rollback(leg.assetId, leg.assetType, leg.destination, leg.amount, operationId);
        leg.status = LEG_STATUS_ROLLED_BACK; // TODO: will it change the value in the mapping?
    }

    function transferProof(
        bytes16 contextId,
        string memory id,
        uint8 legType,
        bytes memory proofSignature
    )  public virtual {
        Leg memory leg = getLeg(contextId, legType);
        require(verifyReceiptProofSignature(
            id,
            leg.source,
            leg.destination,
            leg.assetType,
            leg.assetId,
            leg.amount,
            Bytes.finIdToAddress(leg.source),
            proofSignature
        ), "Signature is not verified");
        leg.status = LEG_STATUS_TRANSFERRED; // TODO: will it change the value in the mapping?
    }

    function holdProof(
        bytes16 contextId,
        string memory id,
        uint8 legType,
        bytes memory proofSignature
    )  public virtual {
        Leg memory leg = getLeg(contextId, legType);
        require(verifyReceiptProofSignature(
            id,
            leg.source,
            leg.destination,
            leg.assetType,
            leg.assetId,
            leg.amount,
            Bytes.finIdToAddress(leg.source),
            proofSignature
        ), "Signature is not verified");
        leg.status = LEG_STATUS_WITHHELD; // TODO: will it change the value in the mapping?
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

    function getLeg(bytes16 contextId, uint8 legType) public view returns (Leg memory) {
        require(haveContext(contextId), "Context not found");
        if (legType == LEG_ASSET) {
            return contexts[contextId].asset;

        } else if (legType == LEG_SETTLEMENT) {
            return contexts[contextId].settlement;

        } else {
            revert("Invalid leg");
        }
    } 
    
    function getCounterLeg(bytes16 contextId, uint8 legType) public view returns (Leg memory) {
        require(haveContext(contextId), "Context not found");
        if (legType == LEG_ASSET) {
            return contexts[contextId].settlement;

        } else if (legType == LEG_SETTLEMENT) {
            return contexts[contextId].asset;

        } else {
            revert("Invalid leg");
        }
    }

    function getLegByOperationId(bytes16 contextId, bytes16 operationId) public view returns (Leg memory) {
        require(haveContext(contextId), "Context not found");
        if (contexts[contextId].asset.operationId == operationId) {
            return contexts[contextId].asset;

        } else if (contexts[contextId].settlement.operationId == operationId) {
            return contexts[contextId].settlement;

        } else {
            revert("Invalid operationId");
        }
    }

    function getCounterLegByOperationId(bytes16 contextId, bytes16 operationId) public view returns (Leg memory) {
        require(haveContext(contextId), "Context not found");
        if (contexts[contextId].asset.operationId == operationId) {
            return contexts[contextId].settlement;

        } else if (contexts[contextId].settlement.operationId == operationId) {
            return contexts[contextId].asset;

        } else {
            revert("Invalid operationId");
        }
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