// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import {Bytes} from "./Bytes.sol";
import {Signature} from "./Signature.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @dev Library for FinP2P protocol signature verification.
 */
contract FinP2PSignatureVerifier is EIP712 {

    string private constant SIGNING_DOMAIN = "FinP2P";
    string private constant SIGNATURE_VERSION = "1";

    enum PrimaryType {
        PRIMARY_SALE,
        BUYING,
        SELLING,
        REDEMPTION,
        REQUEST_FOR_TRANSFER,
        PRIVATE_OFFER,
        LOAN
    }
    uint8 public constant PRIMARY_TYPE_PRIMARY_SALE = 1;
    uint8 public constant PRIMARY_TYPE_BUYING = 2;
    uint8 public constant PRIMARY_TYPE_SELLING = 3;
    uint8 public constant PRIMARY_TYPE_REDEMPTION = 4;
    uint8 public constant PRIMARY_TYPE_REQUEST_FOR_TRANSFER = 5;
    uint8 public constant PRIMARY_TYPE_PRIVATE_OFFER = 6;
    uint8 public constant PRIMARY_TYPE_LOAN = 7;


    bytes32 private constant FINID_TYPE_HASH = keccak256(
        "FinId(string idkey)"
    );

    bytes32 private constant TERM_TYPE_HASH = keccak256(
        "Term(string assetId,string assetType,string amount)"
    );


    bytes32 private constant PRIMARY_SALE_TYPE_HASH = keccak256(
        "PrimarySale(string nonce,FinId buyer,FinId issuer,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant BUYING_TYPE_HASH = keccak256(
        "Buying(string nonce,FinId buyer,FinId seller,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant SELLING_TYPE_HASH = keccak256(
        "Selling(string nonce,FinId buyer,FinId seller,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant REDEMPTION_TYPE_HASH = keccak256(
        "Redemption(string nonce,FinId seller,FinId issuer,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant REQUEST_FOR_TRANSFER_TYPE_HASH = keccak256(
        "RequestForTransfer(string nonce,FinId buyer,FinId seller,Term asset)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant PRIVATE_OFFER_TYPE_HASH = keccak256(
        "PrivateOffer(string nonce,FinId buyer,FinId seller,Term asset,Term settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant LOAN_TERMS_TYPE_HASH = keccak256(
        "LoanTerms(string openTime,string closeTime,string borrowedMoneyAmount,string returnedMoneyAmount)"
    );

    bytes32 private constant LOAN_TYPE_HASH = keccak256(
        "Loan(string nonce,FinId borrower,FinId lender,Term asset,Term settlement,LoanTerms loanTerms)FinId(string idkey)LoanTerms(string openTime,string closeTime,string borrowedMoneyAmount,string returnedMoneyAmount)Term(string assetId,string assetType,string amount)"
    );

    struct Term {
        string assetId;
        string assetType;
        string amount;
    }

    struct LoanTerm {
        string openTime;
        string closeTime;
        string borrowedMoneyAmount;
        string returnedMoneyAmount;
    }

    constructor() EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {}

    function verifyInvestmentSignature(
        uint8 primaryType,
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        Term memory asset,
        Term memory settlement,
        LoanTerm memory loan,
        string memory signerFinId,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = hashInvestment(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, loan);
        return Signature.verify(Bytes.finIdToAddress(signerFinId), hash, signature);
    }

    // --------------------------------------------------------------------------------------

    function hashFinId(string memory finId) public pure returns (bytes32) {
        return keccak256(abi.encode(FINID_TYPE_HASH, keccak256(bytes(finId))));
    }

    function hashTerm(Term memory term) public pure returns (bytes32) {
        return keccak256(abi.encode(
            TERM_TYPE_HASH,
            keccak256(bytes(term.assetId)),
            keccak256(bytes(term.assetType)),
            keccak256(bytes(term.amount))
        ));
    }

    function hashLoanTerms(LoanTerm memory loan) public pure returns (bytes32) {
        return keccak256(abi.encode(
            LOAN_TERMS_TYPE_HASH,
            keccak256(bytes(loan.openTime)),
            keccak256(bytes(loan.closeTime)),
            keccak256(bytes(loan.borrowedMoneyAmount)),
            keccak256(bytes(loan.returnedMoneyAmount))
        ));
    }

    function hashInvestment(
        uint8 primaryType,
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        Term memory asset,
        Term memory settlement,
        LoanTerm memory loan
    ) public view returns (bytes32) {
        if (primaryType == PRIMARY_TYPE_PRIMARY_SALE) {
            return _hashTypedDataV4(keccak256(abi.encode(
                PRIMARY_SALE_TYPE_HASH,
                keccak256(bytes(nonce)),
                hashFinId(buyerFinId),
                hashFinId(sellerFinId), // issuer
                hashTerm(asset),
                hashTerm(settlement)
            )));

        } else if (primaryType == PRIMARY_TYPE_BUYING) {
            return _hashTypedDataV4(keccak256(abi.encode(
                BUYING_TYPE_HASH,
                keccak256(bytes(nonce)),
                hashFinId(buyerFinId),
                hashFinId(sellerFinId),
                hashTerm(asset),
                hashTerm(settlement)
            )));

        } else if (primaryType == PRIMARY_TYPE_SELLING) {
            return _hashTypedDataV4(keccak256(abi.encode(
                SELLING_TYPE_HASH,
                keccak256(bytes(nonce)),
                hashFinId(buyerFinId),
                hashFinId(sellerFinId),
                hashTerm(asset),
                hashTerm(settlement)
            )));

        } else if (primaryType == PRIMARY_TYPE_REDEMPTION) {
            return _hashTypedDataV4(keccak256(abi.encode(
                REDEMPTION_TYPE_HASH,
                keccak256(bytes(nonce)),
                hashFinId(sellerFinId),
                hashFinId(buyerFinId), // issuer
                hashTerm(asset),
                hashTerm(settlement)
            )));

        } else if (primaryType == PRIMARY_TYPE_REQUEST_FOR_TRANSFER) {
            return _hashTypedDataV4(keccak256(abi.encode(
                REQUEST_FOR_TRANSFER_TYPE_HASH,
                keccak256(bytes(nonce)),
                hashFinId(buyerFinId),
                hashFinId(sellerFinId),
                hashTerm(asset)  // only asset, no settlement
            )));

        } else if (primaryType == PRIMARY_TYPE_PRIVATE_OFFER) {
            return _hashTypedDataV4(keccak256(abi.encode(
                PRIVATE_OFFER_TYPE_HASH,
                keccak256(bytes(nonce)),
                hashFinId(buyerFinId),
                hashFinId(sellerFinId),
                hashTerm(asset),
                hashTerm(settlement)
            )));

        } else if (primaryType == PRIMARY_TYPE_LOAN) {
            return _hashTypedDataV4(keccak256(abi.encode(
                LOAN_TYPE_HASH,
                keccak256(bytes(nonce)),
                hashFinId(sellerFinId),
                hashFinId(buyerFinId),
                hashTerm(asset),
                hashTerm(settlement),
                hashLoanTerms(loan)
            )));
        } else {
            revert("Invalid eip712 transfer signature type");
        }
    }


}