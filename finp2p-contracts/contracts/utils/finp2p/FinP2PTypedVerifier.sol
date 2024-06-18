// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @dev Library for FinP2P protocol signature verification.
 */
contract FinP2PTypedVerifier is EIP712 {

    string private constant SIGNING_DOMAIN = "FinP2P";
    string private constant SIGNATURE_VERSION = "1";

    bytes32 private constant FINID_TYPE_HASH = keccak256(
        "finId(string key)"
    );

    bytes32 private constant ISSUE_TYPE_HASH = keccak256(
        "PrimarySale(bytes nonce,finId buyer,string issuer,string amount,string assetId,string settlementAsset,string settlementAmount)"
    );


    constructor() EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {}

    function _hashFinId(string memory finId) private pure returns (bytes memory) {
        return abi.encode(FINID_TYPE_HASH, keccak256(bytes(finId)));
    }

    function _hashIssue(
        bytes memory nonce,
        string memory buyer,
        string memory issuer,
        string memory amount,
        string memory assetId,
        string memory settlementAsset,
        string memory settlementAmount
    ) private view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            ISSUE_TYPE_HASH,
            keccak256(nonce),
            keccak256(_hashFinId(buyer)),
//            keccak256(bytes(buyer)),
            keccak256(bytes(issuer)),
//            hashFinId(issuer),
            keccak256(bytes(amount)),
            keccak256(bytes(assetId)),
            keccak256(bytes(settlementAsset)),
            keccak256(bytes(settlementAmount))
        )));
    }

    function verifyIssueSignature(
        bytes memory nonce,
        string memory buyer,
        string memory issuer,
        string memory amount,
        string memory assetId,
        string memory settlementAsset,
        string memory settlementAmount,
        address signer,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = _hashIssue(
            nonce,
            buyer,
            issuer,
            amount,
            assetId,
            settlementAsset,
            settlementAmount
        );
        return SignatureChecker.isValidSignatureNow(
            signer,
            hash,
            signature
        );
    }
}