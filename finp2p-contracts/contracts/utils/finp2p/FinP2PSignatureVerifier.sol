// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "./Bytes.sol";
import "./Signature.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @dev Library for FinP2P protocol signature verification.
 */
contract FinP2PSignatureVerifier is EIP712 {

    bytes private constant DEFAULT_ACCOUNT_TYPE = "finId";

    // --------------------------------------------------------------------------------------

    bytes private constant HASHLIST_OPERATION_ISSUE = "issue";
    bytes private constant HASHLIST_OPERATION_TRANSFER = "transfer";
    bytes private constant HASHLIST_OPERATION_REDEEM = "redeem";

    // --------------------------------------------------------------------------------------

    string private constant SIGNING_DOMAIN = "FinP2P";
    string private constant SIGNATURE_VERSION = "1";

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

    function verifyPrimarySaleSignature(
        string memory nonce,
        string memory buyerFinId,
        string memory issuerFinId,
        Term memory asset,
        Term memory settlement,
        address signer,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = hashPrimarySale(nonce, buyerFinId, issuerFinId, asset, settlement);
        return Signature.verify(signer, hash, signature);
    }

    function verifyTransferSignature(
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        Term memory asset,
        Term memory settlement,
        address signer,
        uint8 eip712PrimaryType,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash;
        if (eip712PrimaryType == PRIMARY_TYPE_BUYING) {
            hash = hashBuying(nonce, buyerFinId, sellerFinId, asset, settlement);

        } else if (eip712PrimaryType == PRIMARY_TYPE_SELLING) {
            hash = hashSelling(nonce, buyerFinId, sellerFinId,  asset, settlement);

        } else if (eip712PrimaryType == PRIMARY_TYPE_REDEMPTION) {
            hash = hashRedemption(nonce, buyerFinId, sellerFinId, asset, settlement);

        } else if (eip712PrimaryType == PRIMARY_TYPE_REQUEST_FOR_TRANSFER) {
            hash = hashRequestForTransfer(nonce, buyerFinId, sellerFinId, asset);

        } else if (eip712PrimaryType == PRIMARY_TYPE_PRIVATE_OFFER) {
            hash = hashPrivateOffer(nonce, buyerFinId, sellerFinId,  asset, settlement);

        } else if (eip712PrimaryType == PRIMARY_TYPE_LOAN) {
            // TODO: pass loan terms
            hash = hashLoan(nonce, buyerFinId, sellerFinId, asset, settlement, LoanTerm("0", "0", "0", "0"));

        } else {
            revert("Invalid eip712 transfer signature type");
        }

        return Signature.verify(signer, hash, signature);
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
            TERM_TYPE_HASH,
            keccak256(bytes(loan.openTime)),
            keccak256(bytes(loan.closeTime)),
            keccak256(bytes(loan.borrowedMoneyAmount)),
            keccak256(bytes(loan.returnedMoneyAmount))
        ));
    }

    function hashPrimarySale(
        string memory nonce,
        string memory buyerFind,
        string memory issuerFinId,
        Term memory asset,
        Term memory settlement
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            PRIMARY_SALE_TYPE_HASH,
            keccak256(bytes(nonce)),
            hashFinId(buyerFind),
            hashFinId(issuerFinId),
            hashTerm(asset),
            hashTerm(settlement)
        )));
    }

    function hashBuying(
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        Term memory asset,
        Term memory settlement
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            BUYING_TYPE_HASH,
            keccak256(bytes(nonce)),
            hashFinId(buyerFinId),
            hashFinId(sellerFinId),
            hashTerm(asset),
            hashTerm(settlement)
        )));
    }

    function hashSelling(
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        Term memory asset,
        Term memory settlement
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            SELLING_TYPE_HASH,
            keccak256(bytes(nonce)),
            hashFinId(buyerFinId),
            hashFinId(sellerFinId),
            hashTerm(asset),
            hashTerm(settlement)
        )));
    }

    function hashRedemption(
        string memory nonce,
        string memory issuerFinId,
        string memory sellerFinId,
        Term memory asset,
        Term memory settlement
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            REDEMPTION_TYPE_HASH,
            keccak256(bytes(nonce)),
            hashFinId(sellerFinId),
            hashFinId(issuerFinId),
            hashTerm(asset),
            hashTerm(settlement)
        )));
    }

    function hashRequestForTransfer(
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        Term memory asset
) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            REQUEST_FOR_TRANSFER_TYPE_HASH,
            keccak256(bytes(nonce)),
            hashFinId(buyerFinId),
            hashFinId(sellerFinId),
            hashTerm(asset)
        )));
    }

    function hashPrivateOffer(
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        Term memory asset,
        Term memory settlement
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            PRIVATE_OFFER_TYPE_HASH,
            keccak256(bytes(nonce)),
            hashFinId(buyerFinId),
            hashFinId(sellerFinId),
            hashTerm(asset),
            hashTerm(settlement)
        )));
    }

    function hashLoan(
        string memory nonce,
        string memory borrower,
        string memory lender,
        Term memory asset,
        Term memory settlement,
        LoanTerm memory loan
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            LOAN_TYPE_HASH,
            keccak256(bytes(nonce)),
            hashFinId(borrower),
            hashFinId(lender),
            hashTerm(asset),
            hashTerm(settlement),
            hashLoanTerms(loan)
        )));
    }


}