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
        "PrimarySale(bytes nonce,finId buyer,finId issuer,string amount,string assetId,string settlementAsset,string settlementAmount)"
    );

    constructor() EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {}


    function hashFinId(string memory finId) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            FINID_TYPE_HASH,
            finId
        )));
    }

    function hashIssue(
        bytes memory nonce,
        string memory buyer,
        string memory issuer,
        string memory amount,
        string memory assetId,
        string memory settlementAsset,
        string memory settlementAmount
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            ISSUE_TYPE_HASH,
            nonce,
            hashFinId(buyer),
            hashFinId(issuer),
            amount,
            assetId,
            settlementAsset,
            settlementAmount
        )));
    }

}