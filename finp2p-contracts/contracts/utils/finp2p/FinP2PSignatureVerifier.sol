// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "./Bytes.sol";
import "./Signature.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @dev Library for FinP2P protocol signature verification.
 */
contract FinP2PSignatureVerifier is EIP712 {

    uint8 public constant HASH_TYPE_HASHLIST = 1;
    uint8 public constant HASH_TYPE_EIP712 = 2;

    string private constant SIGNING_DOMAIN = "FinP2P";
    string private constant SIGNATURE_VERSION = "1";

    bytes private constant ISSUE_ACTION = "issue";
    bytes private constant REDEEM_ACTION = "redeem";
    bytes private constant TRANSFER_ACTION = "transfer";
    bytes private constant DEFAULT_ACCOUNT_TYPE = "finId";

    bytes32 private constant FINID_TYPE_HASH = keccak256(
        "FinId(string idkey)"
    );

    bytes32 private constant TERM_TYPE_HASH = keccak256(
        "Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant ISSUE_TYPE_HASH = keccak256(
        "PrimarySale(string nonce,FinId buyer,FinId issuer,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant TRANSFER_TYPE_HASH = keccak256(
        "SecondarySale(string nonce,FinId seller,FinId buyer,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant REDEEM_TYPE_HASH = keccak256(
        "Redemption(string nonce,FinId owner,FinId buyer,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    constructor() EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {}

    function verifyPrimarySaleSignature(
        string memory nonce,
        string memory buyer,
        string memory issuer,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount,
        address signer,
        uint8 hashType,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = hashIssue(hashType, nonce, buyer, issuer, assetId, amount, settlementAsset, settlementAmount);
        return Signature.verify(signer, hash, signature);
    }

    function verifySecondarySaleSignature(
        string memory nonce,
        string memory seller,
        string memory buyer,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount,
        address signer,
        uint8 hashType,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = hashTransfer(hashType, nonce, seller, buyer, assetId, amount, settlementAsset, settlementAmount);
        return Signature.verify(signer, hash, signature);
    }

    function verifyRedemptionSignature(
        string memory nonce,
        string memory owner,
        string memory buyer,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount,
        address signer,
        uint8 hashType,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = hashRedeem(hashType, nonce, owner, buyer, assetId, amount, settlementAsset, settlementAmount);
        return Signature.verify(signer, hash, signature);
    }

    // --------------------------------------------------------------------------------------

    function hashFinId(string memory finId) public pure returns (bytes32) {
        return keccak256(abi.encode(FINID_TYPE_HASH, keccak256(bytes(finId))));
    }

    function hashTerm(string memory assetId, string memory assetType, string memory amount) public pure returns (bytes32) {
        return keccak256(abi.encode(
            TERM_TYPE_HASH,
            keccak256(bytes(assetId)),
            keccak256(bytes(assetType)),
            keccak256(bytes(amount))
        ));
    }

    function hashIssue(
        uint8 hashType,
        string memory nonce,
        string memory buyer,
        string memory issuer,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount
    ) public view returns (bytes32) {
        if (hashType == HASH_TYPE_HASHLIST) {
            return keccak256(abi.encodePacked(
                keccak256(abi.encodePacked(
                    Bytes.fromHexToUint256(nonce),
                    ISSUE_ACTION,
                    "finp2p",
                    assetId,
                    DEFAULT_ACCOUNT_TYPE,
                    issuer,
                    amount
                )),
                keccak256(abi.encodePacked(
                    "fiat",
                    settlementAsset,
                    DEFAULT_ACCOUNT_TYPE,
                    buyer,
                    DEFAULT_ACCOUNT_TYPE,
                    issuer,
                    settlementAmount
                ))
            ));
        } else if (hashType == HASH_TYPE_EIP712) {
            return _hashTypedDataV4(keccak256(abi.encode(
                ISSUE_TYPE_HASH,
                keccak256(bytes(nonce)),
                hashFinId(buyer),
                hashFinId(issuer),
                hashTerm(assetId, "finp2p", amount),
                hashTerm(settlementAsset, "fiat", settlementAmount)
            )));
        } else {
            revert("Invalid hash type");
        }
    }


    function hashTransfer(
        uint8 hashType,
        string memory nonce,
        string memory seller,
        string memory buyer,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount
    ) public view returns (bytes32) {
        if (hashType == HASH_TYPE_HASHLIST) {
            if (bytes(settlementAsset).length == 0) {
                return keccak256(abi.encodePacked(
                    keccak256(abi.encodePacked(
                        Bytes.fromHexToUint256(nonce),
                        TRANSFER_ACTION,
                        "finp2p",
                        assetId,
                        DEFAULT_ACCOUNT_TYPE,
                        seller,
                        DEFAULT_ACCOUNT_TYPE,
                        buyer,
                        amount
                    ))
                ));
            } else {
                return keccak256(abi.encodePacked(
                    keccak256(abi.encodePacked(
                        Bytes.fromHexToUint256(nonce),
                        TRANSFER_ACTION,
                        "finp2p",
                        assetId,
                        DEFAULT_ACCOUNT_TYPE,
                        seller,
                        DEFAULT_ACCOUNT_TYPE,
                        buyer,
                        amount
                    )),
                    keccak256(abi.encodePacked(
                        "fiat",
                        settlementAsset,
                        DEFAULT_ACCOUNT_TYPE,
                        buyer,
                        DEFAULT_ACCOUNT_TYPE,
                        seller,
                        settlementAmount
                    ))
                ));
            }
        } else if (hashType == HASH_TYPE_EIP712) {
            return _hashTypedDataV4(keccak256(abi.encode(
                TRANSFER_TYPE_HASH,
                keccak256(bytes(nonce)),
                hashFinId(seller),
                hashFinId(buyer),
                hashTerm(assetId, "finp2p", amount),
                hashTerm(settlementAsset, "fiat", settlementAmount)
            )));
        } else {
            revert("Invalid hash type");
        }
    }

    function hashRedeem(
        uint8 hashType,
        string memory nonce,
        string memory owner,
        string memory buyer,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount
    ) public view returns (bytes32) {
        if (hashType == HASH_TYPE_HASHLIST) {
            return keccak256(abi.encodePacked(
                keccak256(abi.encodePacked(
                    Bytes.fromHexToUint256(nonce),
                    REDEEM_ACTION,
                    "finp2p",
                    assetId,
                    DEFAULT_ACCOUNT_TYPE,
                    owner,
                    amount
                )),
                keccak256(abi.encodePacked(
                    "fiat",
                    settlementAsset,
                    DEFAULT_ACCOUNT_TYPE,
                    buyer,
                    DEFAULT_ACCOUNT_TYPE,
                    owner,
                    settlementAmount
                ))
            ));

        } else if (hashType == HASH_TYPE_EIP712) {
            return _hashTypedDataV4(keccak256(abi.encode(
                REDEEM_TYPE_HASH,
                keccak256(bytes(nonce)),
                hashFinId(owner),
                hashFinId(buyer),
                hashTerm(assetId, "finp2p", amount),
                hashTerm(settlementAsset, "fiat", settlementAmount)
            )));
        } else {
            revert("Invalid hash type");
        }
    }
}