// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {StringUtils} from "../../utils/StringUtils.sol";
import {Burnable} from "../../utils/erc20/Burnable.sol";
import {Mintable} from "../../utils/erc20/Mintable.sol";
import {FinIdUtils} from "../../utils/finp2p/FinIdUtils.sol";
import {FinP2PSignatureVerifier} from "../../utils/finp2p/FinP2PSignatureVerifier.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAssetCollateralAccount} from "./IAssetCollateralAccount.sol";
import {IFinP2PCollateralBasketManager} from "./IFinP2PCollateralBasketManager.sol";

/**
 * @dev FINP2POperatorERC20
 *
 * This contract implements the FINP2P protocol operations for ERC20 tokens.
 * It allows to associate and remove assets, issue, transfer and redeem tokens.
 * It also allows to hold and release tokens in escrow.
 *
 */
contract FINP2POperatorERC20Collateral is AccessControl, FinP2PSignatureVerifier {
    using StringUtils for string;
    using StringUtils for uint256;
    using FinIdUtils for string;

    string public constant VERSION = "0.23.2";

    bytes32 private constant ASSET_MANAGER = keccak256("ASSET_MANAGER");
    bytes32 private constant TRANSACTION_MANAGER = keccak256("TRANSACTION_MANAGER");

    struct LockInfo {
        string assetId;
        AssetType assetType;
        string source;
        string destination;
        string amount;
    }

    /// @notice Issue event
    /// @param assetId The asset id
    /// @param assetType The asset type
    /// @param issuerFinId The FinID of the issuer
    /// @param quantity The quantity issued
    event Issue(string assetId, AssetType assetType, string issuerFinId, string quantity);

    /// @notice Transfer event
    /// @param assetId The asset id
    /// @param assetType The asset type
    /// @param sourceFinId The FinID of the source
    /// @param destinationFinId The FinID of the destination
    /// @param quantity The quantity transferred
    event Transfer(string assetId, AssetType assetType, string sourceFinId, string destinationFinId, string quantity);

    /// @notice Hold event
    /// @param assetId The asset id
    /// @param assetType The asset type
    /// @param finId The FinID of the holder
    /// @param quantity The quantity held
    /// @param operationId The operation id
    event Hold(string assetId, AssetType assetType, string finId, string quantity, string operationId);

    /// @notice Release event
    /// @param assetId The asset id
    /// @param assetType The asset type
    /// @param sourceFinId The FinID of the source
    /// @param destinationFinId The FinID of the destination
    /// @param quantity The quantity released
    /// @param operationId The operation id
    event Release(string assetId, AssetType assetType, string sourceFinId, string destinationFinId, string quantity, string operationId);

    /// @notice Redeem event
    /// @param assetId The asset id
    /// @param assetType The asset type
    /// @param ownerFinId The FinID of the owner
    /// @param quantity The quantity redeemed
    /// @param operationId The operation id
    event Redeem(string assetId, AssetType assetType, string ownerFinId, string quantity, string operationId);

    enum TokenType {
        ERC20,
        COLLATERAL
    }

    struct Asset {
        TokenType tokenType;
        address tokenAddress;
        string basketId;
    }

    struct Lock {
        string assetId;
        AssetType assetType;
        string source;
        string destination;
        string amount;
    }

    address private escrowWalletAddress;
    address private collateralAssetManagerAddress;
    mapping(string => Asset) private assets;
    mapping(string => Lock) private locks;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ASSET_MANAGER, _msgSender());
        _grantRole(TRANSACTION_MANAGER, _msgSender());
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

//    /// @notice Set escrow wallet address
//    /// @param _escrowWalletAddress The escrow wallet address
//    function setEscrowWalletAddress(address _escrowWalletAddress) external {
//        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperatorERC20: must have admin role to set escrow wallet address");
//        escrowWalletAddress = _escrowWalletAddress;
//    }

    /// @notice Set collateral asset manager address
    /// @param _collateralAssetManagerAddress The collateral asset manager address
    function setCollateralAssetManagerAddress(address _collateralAssetManagerAddress) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperatorERC20: must have admin role to set collateral asset manager");
        collateralAssetManagerAddress = _collateralAssetManagerAddress;
    }

    /// @notice Associate an asset with a token address
    /// @param assetId The asset id
    /// @param tokenAddress The token address
    function associateAsset(string calldata assetId, address tokenAddress) external {
        require(hasRole(ASSET_MANAGER, _msgSender()), "FINP2POperatorERC20: must have asset manager role to associate asset");
        require(!_haveAsset(assetId), "Asset already exists");
        assets[assetId] = Asset(TokenType.ERC20, tokenAddress, "");
    }

    function associateCollateralAsset(string calldata assetId, string calldata basketId) external {
        require(hasRole(ASSET_MANAGER, _msgSender()), "FINP2POperatorERC20: must have asset manager role to associate asset");
        require(!_haveAsset(assetId), "Asset already exists");
        assets[assetId] = Asset(TokenType.COLLATERAL, collateralAssetManagerAddress, basketId);
    }

//    /// @notice Remove an asset
//    /// @param assetId The asset id
//    function removeAsset(string calldata assetId) external {
//        require(hasRole(ASSET_MANAGER, _msgSender()), "FINP2POperatorERC20: must have asset manager role to remove asset");
//        require(_haveAsset(assetId), "Asset not found");
//        delete assets[assetId];
//    }

    /// @notice Get the token address of an asset
    /// @param assetId The asset id
    /// @return The token address
    function getAssetAddress(string calldata assetId) external view returns (address) {
        require(_haveAsset(assetId), "Asset not found");
        Asset memory asset = assets[assetId];
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
        Asset memory asset = assets[assetId];
        if (asset.tokenType == TokenType.ERC20) {
            uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
            uint256 tokenBalance = IERC20(asset.tokenAddress).balanceOf(addr);
            return tokenBalance.uintToString(tokenDecimals);

        } else if (asset.tokenType == TokenType.COLLATERAL) {
            require(collateralAssetManagerAddress != address(0), "Collateral asset manager address not set");
            if (IFinP2PCollateralBasketManager(collateralAssetManagerAddress).hasActiveBasket(asset.basketId, addr)) {
                return "1";
            } else {
                return "0";
            }
        } else {
            revert("Invalid token type");
        }
    }

    /// @notice Issue asset to the issuer
    /// @param issuerFinId The FinID of the issuer
    /// @param assetTerm The asset term to issue
    function issue(
        string calldata issuerFinId,
        Term calldata assetTerm
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to issue asset");
        _mint(issuerFinId.toAddress(), assetTerm.assetId, assetTerm.amount);
        emit Issue(assetTerm.assetId, assetTerm.assetType, issuerFinId, assetTerm.amount);
    }

    /// @notice Transfer asset from seller to buyer
    /// @param nonce The investor signature nonce
    /// @param sellerFinId The FinID of the seller
    /// @param buyerFinId The FinID of the buyer
    /// @param assetTerm The asset term to transfer
    /// @param settlementTerm The settlement term to transfer
    /// @param loanTerm The loan term to transfer, could be empty
    /// @param op The operation parameters
    /// @param signature The investor signature
    /// @param signature The investor signature
    function transfer(
        string memory nonce,
        string memory sellerFinId,
        string memory buyerFinId,
        Term memory assetTerm,
        Term memory settlementTerm,
        LoanTerm memory loanTerm,
        OperationParams memory op,
        bytes memory signature
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to transfer asset");
        (string memory source,
            string memory destination,
            string memory assetId,
            AssetType assetType,
            string memory amount) = _extractDetails(sellerFinId, buyerFinId, assetTerm, settlementTerm, op);
        require(verifyInvestmentSignature(
            op,
            nonce,
            buyerFinId,
            sellerFinId,
            assetTerm,
            settlementTerm,
            loanTerm,
            source,
            signature
        ), "Signature is not verified");
        _transfer(source.toAddress(), destination.toAddress(), assetId, amount, op.phase);
        emit Transfer(assetId, assetType, source, destination, amount);
    }

    /// @notice Redeem asset from the owner
    /// @param ownerFinId The FinID of the owner
    /// @param term The term to redeem
    function redeem(
        string calldata ownerFinId,
        Term calldata term
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");
        _burn(ownerFinId.toAddress(), term.assetId, term.amount);
        emit Redeem(term.assetId, term.assetType, ownerFinId, term.amount, '');
    }

    /// @notice Hold asset in escrow
    /// @param nonce The investor signature nonce
    /// @param sellerFinId The FinID of the seller
    /// @param buyerFinId The FinID of the buyer
    /// @param assetTerm The asset term to hold
    /// @param settlementTerm The settlement term to hold
    /// @param loanTerm The loan term to hold, could be empty
    /// @param op The operation parameters
    /// @param signature The investor signature
    function hold(
        string memory nonce,
        string memory sellerFinId,
        string memory buyerFinId,
        Term memory assetTerm,
        Term memory settlementTerm,
        LoanTerm memory loanTerm,
        OperationParams memory op,
        bytes memory signature
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to hold asset");
        (string memory source,
            string memory destination,
            string memory assetId, AssetType assetType,
            string memory amount) = _extractDetails(sellerFinId, buyerFinId, assetTerm, settlementTerm, op);
        require(verifyInvestmentSignature(
            op,
            nonce,
            buyerFinId,
            sellerFinId,
            assetTerm,
            settlementTerm,
            loanTerm,
            source,
            signature
        ), "Signature is not verified");

        _transfer(source.toAddress(), _getEscrow(), assetId, amount, op.phase);
        if (op.releaseType == ReleaseType.RELEASE) {
            locks[op.operationId] = Lock(assetId, assetType, source, destination, amount);
        } else if (op.releaseType == ReleaseType.REDEEM) {
            locks[op.operationId] = Lock(assetId, assetType, source, '', amount);
        } else {
            revert("Invalid release type");
        }
        emit Hold(assetId, assetType, source, amount, op.operationId);
    }

    /// @notice Release asset from escrow to the destination
    /// @param operationId The operation id, a connection between hold and release
    /// @param toFinId The FinID of the destination
    /// @param quantity The quantity to release
    function releaseTo(
        string calldata operationId,
        string calldata toFinId,
        string calldata quantity
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");
        require(_haveContract(operationId), "Contract does not exists");
        Lock storage lock = locks[operationId];
        require(lock.amount.equals(quantity), "Trying to release amount different from the one held");
        require(lock.destination.equals(toFinId), "Trying to release to different destination than the one expected in the lock");

        _transfer(_getEscrow(), toFinId.toAddress(), lock.assetId, lock.amount, Phase.NONE);
        emit Release(lock.assetId, lock.assetType, lock.source, lock.destination, quantity, operationId);
        delete locks[operationId];
    }

    /// @notice Release asset from escrow and redeem it
    /// @param operationId The operation id, a connection between hold and release
    /// @param ownerFinId The FinID of the owner
    /// @param quantity The quantity to redeem
    function releaseAndRedeem(
        string calldata operationId,
        string calldata ownerFinId,
        string calldata quantity
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to release asset");
        require(_haveContract(operationId), "Contract does not exists");
        Lock storage lock = locks[operationId];
        require(lock.source.equals(ownerFinId), "Trying to redeem asset with owner different from the one who held it");
        require(bytes(lock.destination).length == 0, "Trying to redeem asset with non-empty destination");
        require(lock.amount.equals(quantity), "Trying to redeem amount different from the one held");
        _burn(_getEscrow(), lock.assetId, lock.amount);
        emit Redeem(lock.assetId, lock.assetType, ownerFinId, quantity, operationId);
        delete locks[operationId];
    }

    /// @notice Release asset from escrow back to the source
    /// @param operationId The operation id of the withheld asset
    function releaseBack(
        string memory operationId
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperatorERC20: must have transaction manager role to rollback asset");
        require(_haveContract(operationId), "contract does not exists");
        Lock storage lock = locks[operationId];
        _transfer(_getEscrow(), lock.source.toAddress(), lock.assetId, lock.amount, Phase.NONE);
        emit Release(lock.assetId, lock.assetType, lock.source, "", lock.amount, operationId);
        delete locks[operationId];
    }

    /// @notice Get the lock info
    /// @param operationId The operation id
    /// @return The lock info
    function getLockInfo(string memory operationId) external view returns (LockInfo memory) {
        require(_haveContract(operationId), "Contract not found");
        Lock storage l = locks[operationId];
        return LockInfo(l.assetId, l.assetType, l.source, l.destination, l.amount);
    }

//    function addAllowedDomain(uint256 chainId, address verifyingContract) external {
//        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperatorERC20: must have admin role to add allowed domains");
//        _addAllowedDomain(chainId, verifyingContract);
//    }

    // ------------------------------------------------------------------------------------------

    function _haveAsset(string memory assetId) internal view returns (bool exists) {
        exists = (assets[assetId].tokenAddress != address(0));
    }

    function _haveContract(string memory operationId) internal view returns (bool exists) {
        exists = (bytes(locks[operationId].amount).length > 0);
    }


    function _mint(address to, string memory assetId, string memory quantity) internal {
        require(_haveAsset(assetId), "Asset not found");
        Asset memory asset = assets[assetId];

        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        Mintable(asset.tokenAddress).mint(to, tokenAmount);
    }

    function _transfer(address from, address to, string memory assetId, string memory quantity, Phase phase) internal {
        require(_haveAsset(assetId), "Asset not found");
        Asset memory asset = assets[assetId];

        if (asset.tokenType == TokenType.ERC20) {
            uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
            uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
            uint256 balance = IERC20(asset.tokenAddress).balanceOf(from);
            require(balance >= tokenAmount, "Not sufficient balance to transfer");

            IERC20(asset.tokenAddress).transferFrom(from, to, tokenAmount);

        } else if (asset.tokenType == TokenType.COLLATERAL) {
            require(collateralAssetManagerAddress != address(0), "Collateral asset manager address not set");
            IFinP2PCollateralBasketManager(collateralAssetManagerAddress).process(asset.basketId, quantity, phase);

        } else {
            revert("Invalid token type");
        }
    }

    function _burn(address from, string memory assetId, string memory quantity) internal {
        require(_haveAsset(assetId), "Asset not found");
        Asset memory asset = assets[assetId];

        uint8 tokenDecimals = IERC20Metadata(asset.tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        uint256 balance = IERC20(asset.tokenAddress).balanceOf(from);
        require(balance >= tokenAmount, "Not sufficient balance to burn");
        Burnable(asset.tokenAddress).burn(from, tokenAmount);
    }

    /// @notice Extract the direction of the operation
    /// @param sellerFinId The FinID of the seller
    /// @param buyerFinId The FinID of the buyer
    /// @param assetTerm The asset term
    /// @param settlementTerm The settlement term
    /// @param op The operation parameters
    /// @return The source FinID, the destination FinID, the asset id, the asset type, the amount
    function _extractDetails(
        string memory sellerFinId,
        string memory buyerFinId,
        Term memory assetTerm,
        Term memory settlementTerm,
        OperationParams memory op
    ) internal pure returns (string memory, string memory, string memory, AssetType, string memory) {
        if (op.leg == LegType.ASSET) {
            if (op.phase == Phase.INITIATE) {
                return (sellerFinId, buyerFinId, assetTerm.assetId, assetTerm.assetType, assetTerm.amount);
            } else if (op.phase == Phase.CLOSE) {
                return (buyerFinId, sellerFinId, assetTerm.assetId, assetTerm.assetType, assetTerm.amount);
            } else {
                revert("Invalid phase");
            }
        } else if (op.leg == LegType.SETTLEMENT) {
            if (op.phase == Phase.INITIATE) {
                return (buyerFinId, sellerFinId, settlementTerm.assetId, settlementTerm.assetType, settlementTerm.amount);
            } else if (op.phase == Phase.CLOSE) {
                return (sellerFinId, buyerFinId, settlementTerm.assetId, settlementTerm.assetType, settlementTerm.amount);
            } else {
                revert("Invalid phase");
            }
        } else {
            revert("Invalid leg");
        }
    }

    function _getEscrow() public view returns (address) {
        if (escrowWalletAddress == address(0)) {
            return address(this);
        } else {
            return escrowWalletAddress;
        }
    }
}