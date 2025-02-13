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
        "PrimarySale(string nonce,FinId buyer,FinId issuer,Term memory asset,Term memory settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_BUYING_TYPE_HASH = keccak256(
        "Buying(string nonce,FinId buyer,FinId seller,Term memory asset,Term memory settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_SELLING_TYPE_HASH = keccak256(
        "Selling(string nonce,FinId buyer,FinId seller,Term memory asset,Term memory settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_REDEMPTION_TYPE_HASH = keccak256(
        "Redemption(string nonce,FinId seller,FinId issuer,Term memory asset,Term memory settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_REQUEST_FOR_TRANSFER_TYPE_HASH = keccak256(
        "RequestForTransfer(string nonce,FinId buyer,FinId seller,Term memory asset)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_PRIVATE_OFFER_TYPE_HASH = keccak256(
        "PrivateOffer(string nonce,FinId buyer,FinId seller,Term memory asset,Term memory settlement)FinId(string idkey)Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant EIP712_LOAN_TERMS_TYPE_HASH = keccak256(
        "LoanTerms(string openTime,string closeTime,string borrowedMoneyAmount,string returnedMoneyAmount)"
    );

    bytes32 private constant EIP712_LOAN_TYPE_HASH = keccak256(
        "Loan(string nonce,FinId borrower,FinId lender,Term memory asset,Term memory settlement,LoanTerms loanTerms)FinId(string idkey)LoanTerms(string openTime,string closeTime,string borrowedMoneyAmount,string returnedMoneyAmount)Term(string assetId,string assetType,string amount)"
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

    constructor() EIP712(EIP712_SIGNING_DOMAIN, EIP712_SIGNATURE_VERSION) {}

    function verifyPrimarySaleSignature(
        string memory nonce,
        string memory buyerFinId,
        string memory issuerFinId,
        Term memory asset,
        Term memory settlement,
        address signer,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = eip712HashPrimarySale(nonce, buyerFinId, issuerFinId, asset, settlement);
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
        if (eip712PrimaryType == EIP712_PRIMARY_TYPE_BUYING) {
            hash = eip712HashBuying(nonce, buyerFinId, sellerFinId, asset, settlement);

        } else if (eip712PrimaryType == EIP712_PRIMARY_TYPE_SELLING) {
            hash = eip712HashSelling(nonce, buyerFinId, sellerFinId,  asset, settlement);

        } else if (eip712PrimaryType == EIP712_PRIMARY_TYPE_REDEMPTION) {
            hash = eip712HashRedemption(nonce, buyerFinId, sellerFinId, asset, settlement);

        } else if (eip712PrimaryType == EIP712_PRIMARY_TYPE_REQUEST_FOR_TRANSFER) {
            hash = eip712HashRequestForTransfer(nonce, buyerFinId, sellerFinId, asset);

        } else if (eip712PrimaryType == EIP712_PRIMARY_TYPE_PRIVATE_OFFER) {
            hash = eip712HashPrivateOffer(nonce, buyerFinId, sellerFinId,  asset, settlement);

        } else if (eip712PrimaryType == EIP712_PRIMARY_TYPE_LOAN) {
            // TODO: pass loan terms
            hash = eip712HashLoan(nonce, buyerFinId, sellerFinId, asset, settlement, LoanTerm("0", "0", "0", "0"));

        } else {
            revert("Invalid eip712 transfer signature type");
        }

        return Signature.verify(signer, hash, signature);
    }


    // --------------------------------------------------------------------------------------

    function eip712HashFinId(string memory finId) public pure returns (bytes32) {
        return keccak256(abi.encode(EIP712_FINID_TYPE_HASH, keccak256(bytes(finId))));
    }

    function eip712HashTerm(Term memory term) public pure returns (bytes32) {
        return keccak256(abi.encode(
            EIP712_TERM_TYPE_HASH,
            keccak256(bytes(term.assetId)),
            keccak256(bytes(term.assetType)),
            keccak256(bytes(term.amount))
        ));
    }

    function eip712HashLoanTerms(LoanTerm memory loan) public pure returns (bytes32) {
        return keccak256(abi.encode(
            EIP712_TERM_TYPE_HASH,
            keccak256(bytes(loan.openTime)),
            keccak256(bytes(loan.closeTime)),
            keccak256(bytes(loan.borrowedMoneyAmount)),
            keccak256(bytes(loan.returnedMoneyAmount))
        ));
    }

    function eip712HashPrimarySale(
        string memory nonce,
        string memory buyerFind,
        string memory issuerFinId,
        Term memory asset,
        Term memory settlement
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_PRIMARY_SALE_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(buyerFind),
            eip712HashFinId(issuerFinId),
            eip712HashTerm(asset),
            eip712HashTerm(settlement)
        )));
    }

    function eip712HashBuying(
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        Term memory asset,
        Term memory settlement
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_BUYING_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(buyerFinId),
            eip712HashFinId(sellerFinId),
            eip712HashTerm(asset),
            eip712HashTerm(settlement)
        )));
    }

    function eip712HashSelling(
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        Term memory asset,
        Term memory settlement
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_SELLING_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(buyerFinId),
            eip712HashFinId(sellerFinId),
            eip712HashTerm(asset),
            eip712HashTerm(settlement)
        )));
    }

    function eip712HashRedemption(
        string memory nonce,
        string memory issuerFinId,
        string memory sellerFinId,
        Term memory asset,
        Term memory settlement
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_REDEMPTION_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(sellerFinId),
            eip712HashFinId(issuerFinId),
            eip712HashTerm(asset),
            eip712HashTerm(settlement)
        )));
    }

    function eip712HashRequestForTransfer(
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        Term memory asset
) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_REQUEST_FOR_TRANSFER_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(buyerFinId),
            eip712HashFinId(sellerFinId),
            eip712HashTerm(asset)
        )));
    }

    function eip712HashPrivateOffer(
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        Term memory asset,
        Term memory settlement
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_PRIVATE_OFFER_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(buyerFinId),
            eip712HashFinId(sellerFinId),
            eip712HashTerm(asset),
            eip712HashTerm(settlement)
        )));
    }

    function eip712HashLoan(
        string memory nonce,
        string memory borrower,
        string memory lender,
        Term memory asset,
        Term memory settlement,
        LoanTerm memory loan
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EIP712_LOAN_TYPE_HASH,
            keccak256(bytes(nonce)),
            eip712HashFinId(borrower),
            eip712HashFinId(lender),
            eip712HashTerm(asset),
            eip712HashTerm(settlement),
            eip712HashLoanTerms(loan)
        )));
    }


}