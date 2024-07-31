// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./Signature.sol";

/**
 * @dev Library for FinP2P protocol signature verification.
 */
contract FinP2PTypedVerifier is EIP712 {

    string private constant SIGNING_DOMAIN = "FinP2P";
    string private constant SIGNATURE_VERSION = "1";

    bytes32 private constant FINID_TYPE_HASH = keccak256(
        "FinId(string idkey)"
    );

    bytes32 private constant TERM_TYPE_HASH = keccak256(
        "Term(string assetId,string assetType,uint256 amount)"
    );

    bytes32 private constant ISSUE_TYPE_HASH = keccak256(
        "PrimarySale(string nonce,FinId buyer,FinId issuer,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,uint256 amount)"
    );

    bytes32 private constant TRANSFER_TYPE_HASH = keccak256(
        "SecondarySale(string nonce,FinId seller,FinId buyer,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,uint256 amount)"
    );

    bytes32 private constant REDEEM_TYPE_HASH = keccak256(
        "Redemption(string nonce,FinId owner,FinId buyer,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,uint256 amount)"
    );

    constructor() EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {}

    function verifyPrimarySaleSignature(
        string memory nonce,
        string memory buyer,
        string memory issuer,
        string memory assetId,
        uint256 amount,
        string memory settlementAsset,
        uint256 settlementAmount,
        address signer,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = hashIssue(nonce, buyer, issuer, assetId, amount, settlementAsset, settlementAmount);
        return Signature.verify(signer, hash, signature);
    }

    function verifySecondarySaleSignature(
        string memory nonce,
        string memory seller,
        string memory buyer,
        string memory assetId,
        uint256 amount,
        string memory settlementAsset,
        uint256 settlementAmount,
        address signer,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = hashTransfer(nonce, seller, buyer, assetId, amount, settlementAsset, settlementAmount);
        return Signature.verify(signer, hash, signature);
    }

    function verifyRedemptionSignature(
        string memory nonce,
        string memory owner,
        string memory buyer,
        string memory assetId,
        uint256 amount,
        string memory settlementAsset,
        uint256 settlementAmount,
        address signer,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = hashRedeem(nonce, owner, buyer, assetId, amount, settlementAsset, settlementAmount);
        return Signature.verify(signer, hash, signature);
    }

    // --------------------------------------------------------------------------------------

    function hashFinId(string memory finId) public pure returns (bytes32) {
        return keccak256(abi.encode(FINID_TYPE_HASH, keccak256(bytes(finId))));
    }

    function hashTerm(string memory assetId, string memory assetType, uint256 amount) public pure returns (bytes32) {
        return keccak256(abi.encode(
            TERM_TYPE_HASH,
            keccak256(bytes(assetId)),
            keccak256(bytes(assetType)),
            amount
        ));
    }

    function hashIssue(
        string memory nonce,
        string memory buyer,
        string memory issuer,
        string memory assetId,
        uint256 amount,
        string memory settlementAsset,
        uint256 settlementAmount
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            ISSUE_TYPE_HASH,
            keccak256(bytes(nonce)),
            hashFinId(buyer),
            hashFinId(issuer),
            hashTerm(assetId, "finp2p", amount),
            hashTerm(settlementAsset, "fiat", settlementAmount)
        )));
    }

    function hashTransfer(
        string memory nonce,
        string memory seller,
        string memory buyer,
        string memory assetId,
        uint256 amount,
        string memory settlementAsset,
        uint256 settlementAmount
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            TRANSFER_TYPE_HASH,
            keccak256(bytes(nonce)),
            hashFinId(seller),
            hashFinId(buyer),
            hashTerm(assetId, "finp2p", amount),
            hashTerm(settlementAsset, "fiat", settlementAmount)
        )));
    }

    function hashRedeem(
        string memory nonce,
        string memory owner,
        string memory buyer,
        string memory assetId,
        uint256 amount,
        string memory settlementAsset,
        uint256 settlementAmount
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            REDEEM_TYPE_HASH,
            keccak256(bytes(nonce)),
            hashFinId(owner),
            hashFinId(buyer),
            hashTerm(assetId, "finp2p", amount),
            hashTerm(settlementAsset, "fiat", settlementAmount)
        )));
    }
}