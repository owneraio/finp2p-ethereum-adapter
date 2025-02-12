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

    bytes private constant DEFAULT_ACCOUNT_TYPE = "finId";

    // --------------------------------------------------------------------------------------

    bytes private constant HASHLIST_OPERATION_ISSUE = "issue";
    bytes private constant HASHLIST_OPERATION_TRANSFER = "transfer";
    bytes private constant HASHLIST_OPERATION_REDEEM = "redeem";

    // --------------------------------------------------------------------------------------

    string private constant EIP712_SIGNING_DOMAIN = "FinP2P";
    string private constant EIP712_SIGNATURE_VERSION = "1";

    uint8 public constant EIP712_PRIMARY_TYPE_PRIMARY_SALE = 1;
    uint8 public constant EIP712_PRIMARY_TYPE_BUYING = 2;
    uint8 public constant EIP712_PRIMARY_TYPE_SELLING = 3;
    uint8 public constant EIP712_PRIMARY_TYPE_REDEMPTION = 4;
    uint8 public constant EIP712_PRIMARY_TYPE_REQUEST_FOR_TRANSFER = 5;
    uint8 public constant EIP712_PRIMARY_TYPE_PRIVATE_OFFER = 6;
    uint8 public constant EIP712_PRIMARY_TYPE_LOAN = 7;


    bytes32 private constant EIP712_FINID_TYPE_HASH = keccak256(
        "FinId(string idkey)"
    );

    bytes32 private constant EIP712_TERM_TYPE_HASH = keccak256(
        "Term(string assetId,string assetType,string amount)"
    );


    bytes32 private constant EIP712_PRIMARY_SALE_TYPE_HASH = keccak256(
        "PrimarySale(string nonce,FinId buyer,FinId issuer,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_BUYING_TYPE_HASH = keccak256(
        "Buying(string nonce,FinId buyer,FinId seller,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_SELLING_TYPE_HASH = keccak256(
        "Selling(string nonce,FinId buyer,FinId seller,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_REDEMPTION_TYPE_HASH = keccak256(
        "Redemption(string nonce,FinId seller,FinId issuer,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_REQUEST_FOR_TRANSFER_TYPE_HASH = keccak256(
        "RequestForTransfer(string nonce,FinId buyer,FinId seller,Term asset)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_PRIVATE_OFFER_TYPE_HASH = keccak256(
        "PrivateOffer(string nonce,FinId buyer,FinId seller,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_LOAN_TERMS_TYPE_HASH = keccak256(
        "LoanTerms(string openTime,string closeTime,string borrowedMoneyAmount,string returnedMoneyAmount)"
    );

    bytes32 private constant EIP712_LOAN_TYPE_HASH = keccak256(
        "Loan(string nonce,FinId borrower,FinId lender,Term asset,Term settlement,LoanTerms loanTerms)FinId(string idkey)LoanTerms(string openTime,string closeTime,string borrowedMoneyAmount,string returnedMoneyAmount)Term(string assetId,string assetType,string amount)"
    );


    constructor() EIP712(EIP712_SIGNING_DOMAIN, EIP712_SIGNATURE_VERSION) {}

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
        bytes32 hash;
        if (hashType == HASH_TYPE_EIP712) {
            hash = eip712HashPrimarySale(nonce, buyer, issuer, assetId, amount, settlementAsset, settlementAmount);

        } else if (hashType == HASH_TYPE_HASHLIST) {
            revert("Hash lists are currently not supported, use EIP712 instead");
//            hash = hashListHashIssue(nonce, buyer, issuer, assetId, amount, settlementAsset, settlementAmount);

        } else {
            revert("Invalid hash type");
        }
        return Signature.verify(signer, hash, signature);
    }

    function verifyTransferSignature(
        string memory nonce,
        string memory buyer,
        string memory seller,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount,
        address signer,
        uint8 hashType,
        uint8 eip712PrimaryType,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash;
        if (hashType == HASH_TYPE_EIP712) {
            if (eip712PrimaryType == EIP712_PRIMARY_TYPE_SELLING) {
                hash = eip712HashSelling(nonce, buyer, seller,  assetId, amount, settlementAsset, settlementAmount);

            } else if (eip712PrimaryType == EIP712_PRIMARY_TYPE_BUYING) {
                hash = eip712HashBuying(nonce, buyer, seller, assetId, amount, settlementAsset, settlementAmount);

            } else if (eip712PrimaryType == EIP712_PRIMARY_TYPE_REQUEST_FOR_TRANSFER) {
                hash = eip712HashRequestForTransfer(nonce, buyer, seller, assetId, amount);

            } else if (eip712PrimaryType == EIP712_PRIMARY_TYPE_PRIVATE_OFFER) {
                hash = eip712HashPrivateOffer(nonce, buyer,seller,  assetId, amount, settlementAsset, settlementAmount);

            } else if (eip712PrimaryType == EIP712_PRIMARY_TYPE_LOAN) {
                // TODO: pass loan terms
                hash = eip712HashLoan(nonce, buyer, seller, assetId, amount, settlementAsset, settlementAmount, "0", "0", "0", "0");

            } else {
                revert("Invalid transfer type");
            }

        } else if (hashType == HASH_TYPE_HASHLIST) {
            revert("Hash lists are currently not supported, use EIP712 instead");
//            hash = hashListHashTransfer(nonce, buyer, seller,  assetId, amount, settlementAsset, settlementAmount);
        } else {
            revert("Invalid hash type");
        }
        return Signature.verify(signer, hash, signature);
    }

    function verifyRedemptionSignature(
        string memory nonce,
        string memory seller,
        string memory issuer,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount,
        address signer,
        uint8 hashType,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash;
        if (hashType == HASH_TYPE_EIP712) {
            hash = eip712HashRedemption(nonce, seller, issuer, assetId, amount, settlementAsset, settlementAmount);
        } else if (hashType == HASH_TYPE_HASHLIST) {
//            hash = hashListHashRedeem(nonce, seller, issuer, assetId, amount, settlementAsset, settlementAmount);
            revert("Hash lists are currently not supported, use EIP712 instead");
        } else {
            revert("Invalid hash type");
        }
        return Signature.verify(signer, hash, signature);
    }

    // --------------------------------------------------------------------------------------

    function eip712HashFinId(string memory finId) public pure returns (bytes32) {
        return keccak256(abi.encode(EIP712_FINID_TYPE_HASH, keccak256(bytes(finId))));
    }

    function eip712HashTerm(string memory assetId, string memory assetType, string memory amount) public pure returns (bytes32) {
        return keccak256(abi.encode(
            EIP712_TERM_TYPE_HASH,
            keccak256(bytes(assetId)),
            keccak256(bytes(assetType)),
            keccak256(bytes(amount))
        ));
    }

    function eip712HashLoanTerms(string memory openTime, string memory closeTime, string memory borrowedMoneyAmount, string memory returnedMoneyAmount) public pure returns (bytes32) {
        return keccak256(abi.encode(
            EIP712_TERM_TYPE_HASH,
            keccak256(bytes(openTime)),
            keccak256(bytes(closeTime)),
            keccak256(bytes(borrowedMoneyAmount)),
            keccak256(bytes(returnedMoneyAmount))
        ));
    }

    function eip712HashPrimarySale(
        string memory nonce,
        string memory buyer,
        string memory issuer,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_PRIMARY_SALE_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(buyer),
            eip712HashFinId(issuer),
            eip712HashTerm(assetId, "finp2p", amount),
            eip712HashTerm(settlementAsset, "fiat", settlementAmount)
        )));
    }

    function eip712HashBuying(
        string memory nonce,
        string memory buyer,
        string memory seller,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_BUYING_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(buyer),
            eip712HashFinId(seller),
            eip712HashTerm(assetId, "finp2p", amount),
            eip712HashTerm(settlementAsset, "fiat", settlementAmount)
        )));
    }

    function eip712HashSelling(
        string memory nonce,
        string memory buyer,
        string memory seller,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_SELLING_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(buyer),
            eip712HashFinId(seller),
            eip712HashTerm(assetId, "finp2p", amount),
            eip712HashTerm(settlementAsset, "fiat", settlementAmount)
        )));
    }

    function eip712HashRedemption(
        string memory nonce,
        string memory seller,
        string memory issuer,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_REDEMPTION_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(seller),
            eip712HashFinId(issuer),
            eip712HashTerm(assetId, "finp2p", amount),
            eip712HashTerm(settlementAsset, "fiat", settlementAmount)
        )));
    }

    function eip712HashRequestForTransfer(
        string memory nonce,
        string memory buyer,
        string memory seller,
        string memory assetId,
        string memory amount
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_REQUEST_FOR_TRANSFER_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(buyer),
            eip712HashFinId(seller),
            eip712HashTerm(assetId, "finp2p", amount)
        )));
    }

    function eip712HashPrivateOffer(
        string memory nonce,
        string memory buyer,
        string memory seller,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_PRIVATE_OFFER_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(buyer),
            eip712HashFinId(seller),
            eip712HashTerm(assetId, "finp2p", amount),
            eip712HashTerm(settlementAsset, "fiat", settlementAmount)
        )));
    }

    function eip712HashLoan(
        string memory nonce,
        string memory borrower,
        string memory lender,
        string memory assetId,
        string memory amount,
        string memory settlementAsset,
        string memory settlementAmount,
        string memory openTime,
        string memory closeTime,
        string memory borrowedMoneyAmount,
        string memory returnedMoneyAmount
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_LOAN_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(borrower),
            eip712HashFinId(lender),
            eip712HashTerm(assetId, "finp2p", amount),
            eip712HashTerm(settlementAsset, "fiat", settlementAmount),
            eip712HashLoanTerms(openTime, closeTime, borrowedMoneyAmount, returnedMoneyAmount)
        )));
    }

    // --------------------------------------------------------------------------------------
//
//    function hashListHashIssue(
//        string memory nonce,
//        string memory buyer,
//        string memory issuer,
//        string memory assetId,
//        string memory amount,
//        string memory settlementAsset,
//        string memory settlementAmount
//    ) public pure returns (bytes32) {
//        return keccak256(abi.encodePacked(
//            keccak256(abi.encodePacked(
//                Bytes.fromHexToUint256(nonce),
//                HASHLIST_OPERATION_ISSUE,
//                "finp2p",
//                assetId,
//                DEFAULT_ACCOUNT_TYPE,
//                issuer,
//                amount
//            )),
//            keccak256(abi.encodePacked(
//                "fiat",
//                settlementAsset,
//                DEFAULT_ACCOUNT_TYPE,
//                buyer,
//                DEFAULT_ACCOUNT_TYPE,
//                issuer,
//                settlementAmount
//            ))
//        ));
//    }

//    function hashListHashRedeem(
//        string memory nonce,
//        string memory owner,
//        string memory buyer,
//        string memory assetId,
//        string memory amount,
//        string memory settlementAsset,
//        string memory settlementAmount
//    ) public pure returns (bytes32) {
//        return keccak256(abi.encodePacked(
//            keccak256(abi.encodePacked(
//                Bytes.fromHexToUint256(nonce),
//                HASHLIST_OPERATION_REDEEM,
//                "finp2p",
//                assetId,
//                DEFAULT_ACCOUNT_TYPE,
//                owner,
//                amount
//            )),
//            keccak256(abi.encodePacked(
//                "fiat",
//                settlementAsset,
//                DEFAULT_ACCOUNT_TYPE,
//                buyer,
//                DEFAULT_ACCOUNT_TYPE,
//                owner,
//                settlementAmount
//            ))
//        ));
//    }

//    function hashListHashTransfer(
//        string memory nonce,
//        string memory buyer,
//        string memory seller,
//        string memory assetId,
//        string memory amount,
//        string memory settlementAsset,
//        string memory settlementAmount
//    ) public pure returns (bytes32) {
//        if (bytes(settlementAsset).length == 0) {
//            return keccak256(abi.encodePacked(
//                keccak256(abi.encodePacked(
//                    Bytes.fromHexToUint256(nonce),
//                    HASHLIST_OPERATION_TRANSFER,
//                    "finp2p",
//                    assetId,
//                    DEFAULT_ACCOUNT_TYPE,
//                    seller,
//                    DEFAULT_ACCOUNT_TYPE,
//                    buyer,
//                    amount
//                ))
//            ));
//        } else {
//            return keccak256(abi.encodePacked(
//                keccak256(abi.encodePacked(
//                    Bytes.fromHexToUint256(nonce),
//                    HASHLIST_OPERATION_TRANSFER,
//                    "finp2p",
//                    assetId,
//                    DEFAULT_ACCOUNT_TYPE,
//                    seller,
//                    DEFAULT_ACCOUNT_TYPE,
//                    buyer,
//                    amount
//                )),
//                keccak256(abi.encodePacked(
//                    "fiat",
//                    settlementAsset,
//                    DEFAULT_ACCOUNT_TYPE,
//                    buyer,
//                    DEFAULT_ACCOUNT_TYPE,
//                    seller,
//                    settlementAmount
//                ))
//            ));
//        }
//    }

}