// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
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
        "FinId(string key)"
    );

    bytes32 private constant TERM_TYPE_HASH = keccak256(
        "Term(string assetId,string assetType,uint256 amount)"
    );

    bytes32 private constant ISSUE_TYPE_HASH = keccak256(
        "PrimarySale(bytes32 nonce,FinId buyer,FinId issuer,Term asset,Term settlement)FinId(string key)Term(string assetId,string assetType,uint256 amount)"
    );

    bytes32 private constant TRANSFER_TYPE_HASH = keccak256(
        "Transfer(bytes32 nonce,FinId buyer,FinId seller,Term asset,Term settlement)FinId(string key)Term(string assetId,string assetType,uint256 amount)"
    );

    bytes32 private constant REDEEM_TYPE_HASH = keccak256(
        "Redeem(bytes32 nonce,FinId owner,Term asset,Term settlement)FinId(string key)Term(string assetId,string assetType,uint256 amount)"
    );

    constructor() EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {}


    function verifyIssueSignature(
        bytes32 nonce,
        string memory buyer,
        string memory issuer,
        string memory assetId,
        uint256 amount,
        bytes32 settlementHash,
        address signer,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = _hashIssue(nonce, buyer, issuer, assetId, amount, settlementHash);
        return Signature.verify(signer, hash, signature);
//        return SignatureChecker.isValidSignatureNow(signer, hash, signature);
    }

    function verifyTransferSignature(
        bytes32 nonce,
        string memory buyer,
        string memory seller,
        string memory assetId,
        uint256 amount,
        bytes32 settlementHash,
        address signer,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = _hashTransfer(nonce, buyer, seller, assetId, amount, settlementHash);
        return SignatureChecker.isValidSignatureNow(signer, hash, signature);
    }

    function verifyRedeemSignature(
        bytes32 nonce,
        string memory owner,
        string memory assetId,
        uint256 amount,
        bytes32 settlementHash,
        address signer,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = _hashRedeem(nonce, owner, assetId, amount, settlementHash);
        return SignatureChecker.isValidSignatureNow(signer, hash, signature);
    }

    // --------------------------------------------------------------------------------------

    function _hashFinId(string memory finId) private pure returns (bytes32) {
        return keccak256(abi.encode(FINID_TYPE_HASH, keccak256(bytes(finId))));
    }

    function _hashTerm(string memory assetId, string memory assetType, uint256 amount) private pure returns (bytes32) {
        return keccak256(abi.encode(
            TERM_TYPE_HASH,
            keccak256(bytes(assetId)),
            keccak256(bytes(assetType)),
            amount
        ));
    }

    function _hashIssue(
        bytes32 nonce,
        string memory buyer,
        string memory issuer,
        string memory assetId,
        uint256 amount,
        bytes32 settlementHash
    ) private view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            ISSUE_TYPE_HASH,
            nonce,
            _hashFinId(buyer),
            _hashFinId(issuer),
            _hashTerm(assetId, "finp2p", amount),
            settlementHash
//            _hashTerm(settlementAsset, "fiat", settlementAmount)
        )));
    }

    function _hashTransfer(
        bytes32 nonce,
        string memory buyer,
        string memory seller,
        string memory assetId,
        uint256 amount,
        bytes32 settlementHash
    ) private view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            TRANSFER_TYPE_HASH,
            nonce,
            _hashFinId(buyer),
            _hashFinId(seller),
            _hashTerm(assetId, "finp2p", amount),
            settlementHash
//            _hashTerm(settlementAsset, "fiat", settlementAmount)
        )));
    }

    function _hashRedeem(
        bytes32 nonce,
        string memory owner,
        string memory assetId,
        uint256 amount,
        bytes32 settlementHash
    ) private view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            REDEEM_TYPE_HASH,
            nonce,
            _hashFinId(owner),
            _hashTerm(assetId, "finp2p", amount),
            settlementHash
//            _hashTerm(settlementAsset, "fiat", settlementAmount)
        )));
    }
}