// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../utils/StringUtils.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {OperationParams, LegType, PrimaryType, Phase, ReleaseType} from "@owneraio/finp2p-ethereum-token-standard/contracts/OperationParams.sol";
import {FinIdUtils} from "../utils/finp2p/FinIdUtils.sol";
import {FinP2PSignatureVerifier} from "../utils/finp2p/FinP2PSignatureVerifier.sol";
import {Burnable} from "../utils/erc20/Burnable.sol";
import {Mintable} from "../utils/erc20/Mintable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @dev FINP2POperator
 *
 * Simplified FinP2P operator contract that works directly with ERC20 tokens.
 * Manages finId-to-address credential mappings and asset-to-token associations.
 * Signature verification still uses cryptographic derivation from finId (secp256k1),
 * while token operations use the mapped wallet address from the credentials registry.
 *
 */
contract FINP2POperator is AccessControl, FinP2PSignatureVerifier {
    using StringUtils for string;
    using StringUtils for uint256;
    using FinIdUtils for string;

    string public constant VERSION = "0.28.2";

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
    event Issue(string assetId, AssetType assetType, string issuerFinId, string quantity);

    /// @notice Transfer event
    event Transfer(string assetId, AssetType assetType, string sourceFinId, string destinationFinId, string quantity);

    /// @notice Hold event
    event Hold(string assetId, AssetType assetType, string finId, string quantity, string operationId);

    /// @notice Release event
    event Release(string assetId, AssetType assetType, string sourceFinId, string destinationFinId, string quantity, string operationId);

    /// @notice Redeem event
    event Redeem(string assetId, AssetType assetType, string ownerFinId, string quantity, string operationId);

    struct Lock {
        string assetId;
        AssetType assetType;
        string source;
        string destination;
        string amount;
    }

    address private escrowWalletAddress;
    mapping(string => Lock) private locks;

    // Credentials: finId -> wallet address
    mapping(string => address) private credentials;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ASSET_MANAGER, admin);
        _grantRole(TRANSACTION_MANAGER, admin);
    }

    function getVersion() external pure returns (string memory) {
        return VERSION;
    }

    // ---- Role management ----

    function grantAssetManagerRole(address account) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperator: must have admin role to grant asset manager role");
        grantRole(ASSET_MANAGER, account);
    }

    function grantTransactionManagerRole(address account) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperator: must have admin role to grant transaction manager role");
        grantRole(TRANSACTION_MANAGER, account);
    }

    function setEscrowWalletAddress(address _escrowWalletAddress) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FINP2POperator: must have admin role to set escrow wallet address");
        escrowWalletAddress = _escrowWalletAddress;
    }

    // ---- Credential management ----

    /// @notice Add a credential mapping from finId to wallet address
    /// @param finId The FinP2P identity
    /// @param addr The wallet address to associate
    function addCredential(string calldata finId, address addr) external {
        require(hasRole(ASSET_MANAGER, _msgSender()), "FINP2POperator: must have asset manager role to add credential");
        require(addr != address(0), "Wallet address cannot be zero");
        credentials[finId] = addr;
    }

    /// @notice Remove a credential mapping
    /// @param finId The FinP2P identity to remove
    function removeCredential(string calldata finId) external {
        require(hasRole(ASSET_MANAGER, _msgSender()), "FINP2POperator: must have asset manager role to remove credential");
        require(_haveCredential(finId), "Credential not found");
        delete credentials[finId];
    }

    /// @notice Get the wallet address for a finId
    /// @param finId The FinP2P identity
    /// @return The mapped wallet address
    function getCredentialAddress(string calldata finId) external view returns (address) {
        require(_haveCredential(finId), "Credential not found");
        return credentials[finId];
    }

    // ---- Asset resolution ----
    // 0.28.2: asset metadata is no longer stored on-chain. The `assetId` in
    // each EIP712 Term carries the ERC20 contract address inline:
    //   "name: <net>, chainId: <id>/<standard>:0x<40-hex>"
    // Off-chain assets (e.g. "vanilla/high:<uuid>") return address(0); token
    // operations become no-ops for those legs (emit event only).

    /// @notice Get the balance of an asset for a FinID.
    /// @return The balance as a decimal string, or "0" if the asset is off-chain.
    function getBalance(
        string calldata assetId,
        string calldata finId
    ) external view returns (string memory) {
        address tokenAddress = _extractTokenAddress(assetId);
        if (tokenAddress == address(0)) return "0";
        address addr = _resolveAddress(finId);
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        uint256 tokenBalance = IERC20(tokenAddress).balanceOf(addr);
        return tokenBalance.uintToString(tokenDecimals);
    }

    // ---- Operations ----

    /// @notice Issue asset to the issuer
    function issue(
        string calldata issuerFinId,
        Term calldata assetTerm,
        OperationParams memory op
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperator: must have transaction manager role to issue asset");
        _mint(_resolveAddress(issuerFinId), assetTerm.assetId, assetTerm.amount);
        emit Issue(assetTerm.assetId, assetTerm.assetType, issuerFinId, assetTerm.amount);
    }

    /// @notice Transfer asset from seller to buyer
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
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperator: must have transaction manager role to transfer asset");
        (string memory source,
            string memory destination,
            string memory assetId,
            AssetType assetType,
            string memory amount) = _extractDetails(sellerFinId, buyerFinId, assetTerm, settlementTerm, loanTerm, op);
        require(verifyInvestmentSignature(
            op.eip712PrimaryType,
            nonce,
            buyerFinId,
            sellerFinId,
            assetTerm,
            settlementTerm,
            loanTerm,
            source,
            signature
        ), "Signature is not verified");
        _transfer(_resolveAddress(source), _resolveAddress(destination), assetId, amount);
        emit Transfer(assetId, assetType, source, destination, amount);
    }

    /// @notice Redeem asset from the owner
    function redeem(
        string calldata ownerFinId,
        Term calldata term,
        OperationParams memory op
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperator: must have transaction manager role to redeem asset");
        _burn(_resolveAddress(ownerFinId), term.assetId, term.amount);
        emit Redeem(term.assetId, term.assetType, ownerFinId, term.amount, '');
    }

    /// @notice Hold asset in escrow
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
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperator: must have transaction manager role to hold asset");
        (string memory source,
            string memory destination,
            string memory assetId, AssetType assetType,
            string memory amount) = _extractDetails(sellerFinId, buyerFinId, assetTerm, settlementTerm, loanTerm, op);
        require(verifyInvestmentSignature(
            op.eip712PrimaryType,
            nonce,
            buyerFinId,
            sellerFinId,
            assetTerm,
            settlementTerm,
            loanTerm,
            source,
            signature
        ), "Signature is not verified");

        _transfer(_resolveAddress(source), _getEscrow(), assetId, amount);
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
    function releaseTo(
        string memory operationId,
        string memory fromFinId,
        string memory toFinId,
        string memory quantity,
        OperationParams memory op
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperator: must have transaction manager role to release asset");
        require(_haveContract(operationId), "Contract does not exists");
        Lock storage lock = locks[operationId];
        require(lock.amount.equals(quantity), "Trying to release amount different from the one held");
        require(lock.source.equals(fromFinId), "Trying to release asset with source different from the one who held it");
        require(lock.destination.equals(toFinId), "Trying to release to different destination than the one expected in the lock");

        _transfer(_getEscrow(), _resolveAddress(toFinId), lock.assetId, lock.amount);
        emit Release(lock.assetId, lock.assetType, lock.source, lock.destination, quantity, operationId);
        delete locks[operationId];
    }

    /// @notice Release asset from escrow and redeem it
    function releaseAndRedeem(
        string calldata operationId,
        string calldata ownerFinId,
        string calldata quantity,
        OperationParams memory op
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperator: must have transaction manager role to release asset");
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
    function releaseBack(
        string memory operationId,
        OperationParams memory op
    ) external {
        require(hasRole(TRANSACTION_MANAGER, _msgSender()), "FINP2POperator: must have transaction manager role to rollback asset");
        require(_haveContract(operationId), "contract does not exists");
        Lock storage lock = locks[operationId];
        _transfer(_getEscrow(), _resolveAddress(lock.source), lock.assetId, lock.amount);
        emit Release(lock.assetId, lock.assetType, lock.source, "", lock.amount, operationId);
        delete locks[operationId];
    }

    /// @notice Get the lock info
    function getLockInfo(string memory operationId) external view returns (LockInfo memory) {
        require(_haveContract(operationId), "Contract not found");
        Lock storage l = locks[operationId];
        return LockInfo(l.assetId, l.assetType, l.source, l.destination, l.amount);
    }

    // ------------------------------------------------------------------------------------------

    function _haveContract(string memory operationId) internal view returns (bool exists) {
        exists = (bytes(locks[operationId].amount).length > 0);
    }

    function _haveCredential(string memory finId) internal view returns (bool) {
        return credentials[finId] != address(0);
    }

    /// @notice Resolve finId to wallet address via credentials mapping
    function _resolveAddress(string memory finId) internal view returns (address) {
        address addr = credentials[finId];
        require(addr != address(0), "Credential not found for finId");
        return addr;
    }

    /// @notice Extracts the ERC20 contract address from a CAIP-style assetId
    ///         of the form: "...<prefix>/<standard>:0x<40-hex>"
    /// Returns address(0) if the assetId doesn't end with that pattern (e.g.
    /// "vanilla/high:<uuid>") — caller should treat as an off-chain asset.
    function _extractTokenAddress(string memory assetId) internal pure returns (address) {
        bytes memory b = bytes(assetId);
        // Minimum length for ":0x<40 hex>" suffix is 43 chars.
        if (b.length < 43) return address(0);
        uint256 xPos = b.length - 42;
        // Expect ':' at xPos-1, then '0' 'x' at xPos, xPos+1
        if (xPos == 0) return address(0);
        if (b[xPos - 1] != ':' || b[xPos] != '0' || (b[xPos + 1] != 'x' && b[xPos + 1] != 'X')) return address(0);
        uint160 addr = 0;
        for (uint256 i = b.length - 40; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            uint8 v;
            if (c >= 0x30 && c <= 0x39) v = c - 0x30;            // '0'-'9'
            else if (c >= 0x61 && c <= 0x66) v = c - 0x61 + 10;  // 'a'-'f'
            else if (c >= 0x41 && c <= 0x46) v = c - 0x41 + 10;  // 'A'-'F'
            else return address(0);
            addr = (addr << 4) | v;
        }
        return address(addr);
    }

    function _mint(address to, string memory assetId, string memory quantity) internal {
        address tokenAddress = _extractTokenAddress(assetId);
        require(tokenAddress != address(0), "Cannot mint an off-chain asset");
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        Mintable(tokenAddress).mint(to, tokenAmount);
    }

    function _transfer(address from, address to, string memory assetId, string memory quantity) internal {
        address tokenAddress = _extractTokenAddress(assetId);
        if (tokenAddress == address(0)) return; // off-chain asset — event-only leg
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        uint256 balance = IERC20(tokenAddress).balanceOf(from);
        require(balance >= tokenAmount, "Not sufficient balance to transfer");
        IERC20(tokenAddress).transferFrom(from, to, tokenAmount);
    }

    function _burn(address from, string memory assetId, string memory quantity) internal {
        address tokenAddress = _extractTokenAddress(assetId);
        require(tokenAddress != address(0), "Cannot burn an off-chain asset");
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        uint256 balance = IERC20(tokenAddress).balanceOf(from);
        require(balance >= tokenAmount, "Not sufficient balance to burn");
        Burnable(tokenAddress).burn(from, tokenAmount);
    }

    function _extractDetails(
        string memory sellerFinId,
        string memory buyerFinId,
        Term memory assetTerm,
        Term memory settlementTerm,
        LoanTerm memory loanTerm,
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
            if (op.eip712PrimaryType == PrimaryType.LOAN) {
                if (op.phase == Phase.INITIATE) {
                    return (buyerFinId, sellerFinId, settlementTerm.assetId, settlementTerm.assetType, loanTerm.borrowedMoneyAmount);
                } else if (op.phase == Phase.CLOSE) {
                    return (sellerFinId, buyerFinId, settlementTerm.assetId, settlementTerm.assetType, loanTerm.returnedMoneyAmount);
                } else {
                    revert("Invalid phase");
                }
            } else {
                return (buyerFinId, sellerFinId, settlementTerm.assetId, settlementTerm.assetType, settlementTerm.amount);
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
