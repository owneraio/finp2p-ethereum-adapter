// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import {FinP2P} from "./FinP2P.sol";
import {EIP712} from "./EIP712.sol";
import {FinIdUtils} from "./FinIdUtils.sol";
import {Signature} from "./Signature.sol";

/**
 * @dev Library for FinP2P protocol signature verification.
 */
contract FinP2PSignatureVerifier is EIP712 {
    using FinIdUtils for string;
    using FinP2P for FinP2P.Domain;
    using FinP2P for FinP2P.AssetType;
    using FinP2P for FinP2P.LegType;
    using FinP2P for FinP2P.OperationParams;
    using FinP2P for FinP2P.Term;

    string private constant SIGNING_DOMAIN = "FinP2P";
    string private constant SIGNATURE_VERSION = "1";

    bytes32 private constant ASSET_TYPE_FINP2P_HASH = keccak256("finp2p");
    bytes32 private constant ASSET_TYPE_FIAT_HASH = keccak256("fiat");
    bytes32 private constant ASSET_TYPE_CRYPTOCURRENCY_HASH = keccak256("cryptocurrency");

    bytes32 private constant FINID_TYPE_HASH = keccak256(
        "FinId(string idkey)"
    );

    bytes32 private constant SOURCE_TYPE_HASH = keccak256(
        "Source(string accountType,string finId)"
    );

    bytes32 private constant DESTINATION_TYPE_HASH = keccak256(
        "Destination(string accountType,string finId)"
    );

    bytes32 private constant ASSET_TYPE_HASH = keccak256(
        "Asset(string assetId,string assetType)"
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


    bytes32 private constant RECEIPT_TYPE_HASH = keccak256(
        "Receipt(string id,Source source,Destination destination,Asset asset,string quantity)Asset(string assetId,string assetType)Destination(string accountType,string finId)Source(string accountType,string finId)"
    );


    constructor() EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {}

    function verifyInvestmentSignature(
        FinP2P.OperationParams memory params,
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        FinP2P.Term memory asset,
        FinP2P.Term memory settlement,
        FinP2P.LoanTerm memory loan,
        string memory signerFinId,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = hashInvestment(params, nonce, buyerFinId, sellerFinId, asset, settlement, loan);
        return Signature.verify(signerFinId.toAddress(), hash, signature);
    }

    function verifyReceiptProofSignature(
        FinP2P.Domain memory domain,
        string memory id,
        string memory source,
        string memory destination,
        FinP2P.AssetType assetType,
        string memory assetId,
        string memory quantity,
        string memory signerFinId,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 hash = hashReceipt(domain, id, source, destination, assetType, assetId, quantity);
        return Signature.verify(signerFinId.toAddress(), hash, signature);
    }

    // --------------------------------------------------------------------------------------

    function hashFinId(string memory finId) public pure returns (bytes32) {
        return keccak256(abi.encode(FINID_TYPE_HASH, keccak256(bytes(finId))));
    }

    function hashSource(string memory accountType, string memory finId) public pure returns (bytes32) {
        return keccak256(abi.encode(
            SOURCE_TYPE_HASH,
            keccak256(bytes(accountType)),
            keccak256(bytes(finId))
        ));
    }

    function hashDestination(string memory accountType, string memory finId) public pure returns (bytes32) {
        return keccak256(abi.encode(
            DESTINATION_TYPE_HASH,
            keccak256(bytes(accountType)),
            keccak256(bytes(finId))
        ));
    }

    function hashAssetType(FinP2P.AssetType assetType) public pure returns (bytes32) {
        if (assetType == FinP2P.AssetType.FINP2P) {
            return ASSET_TYPE_FINP2P_HASH;
        } else if (assetType == FinP2P.AssetType.FIAT) {
            return ASSET_TYPE_FIAT_HASH;
        } else if (assetType == FinP2P.AssetType.CRYPTOCURRENCY) {
            return ASSET_TYPE_CRYPTOCURRENCY_HASH;
        } else {
            revert("Invalid asset type");
        }
    }

    function hashAsset(string memory assetId, FinP2P.AssetType assetType) public pure returns (bytes32) {
        return keccak256(abi.encode(
            TERM_TYPE_HASH,
            keccak256(bytes(assetId)),
            hashAssetType(assetType)
        ));
    }

    function hashTerm(FinP2P.Term memory term) public pure returns (bytes32) {
        return keccak256(abi.encode(
            TERM_TYPE_HASH,
            keccak256(bytes(term.assetId)),
            hashAssetType(term.assetType),
            keccak256(bytes(term.amount))
        ));
    }

    function hashLoanTerms(FinP2P.LoanTerm memory loan) public pure returns (bytes32) {
        return keccak256(abi.encode(
            LOAN_TERMS_TYPE_HASH,
            keccak256(bytes(loan.openTime)),
            keccak256(bytes(loan.closeTime)),
            keccak256(bytes(loan.borrowedMoneyAmount)),
            keccak256(bytes(loan.returnedMoneyAmount))
        ));
    }

    function hashInvestment(
        FinP2P.OperationParams memory params,
        string memory nonce,
        string memory buyerFinId,
        string memory sellerFinId,
        FinP2P.Term memory asset,
        FinP2P.Term memory settlement,
        FinP2P.LoanTerm memory loan
    ) public view returns (bytes32) {
        if (params.primaryType == FinP2P.PrimaryType.PRIMARY_SALE) {
            return _hashTypedDataV4(params.domain,
                keccak256(abi.encode(
                    PRIMARY_SALE_TYPE_HASH,
                    keccak256(bytes(nonce)),
                    hashFinId(buyerFinId),
                    hashFinId(sellerFinId), // issuer
                    hashTerm(asset),
                    hashTerm(settlement)
                )));

        } else if (params.primaryType == FinP2P.PrimaryType.BUYING) {
            return _hashTypedDataV4(params.domain,
                keccak256(abi.encode(
                    BUYING_TYPE_HASH,
                    keccak256(bytes(nonce)),
                    hashFinId(buyerFinId),
                    hashFinId(sellerFinId),
                    hashTerm(asset),
                    hashTerm(settlement)
                )));

        } else if (params.primaryType == FinP2P.PrimaryType.SELLING) {
            return _hashTypedDataV4(params.domain,
                keccak256(abi.encode(
                    SELLING_TYPE_HASH,
                    keccak256(bytes(nonce)),
                    hashFinId(buyerFinId),
                    hashFinId(sellerFinId),
                    hashTerm(asset),
                    hashTerm(settlement)
                )));

        } else if (params.primaryType == FinP2P.PrimaryType.REDEMPTION) {
            return _hashTypedDataV4(params.domain,
                keccak256(abi.encode(
                    REDEMPTION_TYPE_HASH,
                    keccak256(bytes(nonce)),
                    hashFinId(sellerFinId),
                    hashFinId(buyerFinId), // issuer
                    hashTerm(asset),
                    hashTerm(settlement)
                )));

        } else if (params.primaryType == FinP2P.PrimaryType.REQUEST_FOR_TRANSFER) {
            return _hashTypedDataV4(params.domain,
                keccak256(abi.encode(
                    REQUEST_FOR_TRANSFER_TYPE_HASH,
                    keccak256(bytes(nonce)),
                    hashFinId(buyerFinId),
                    hashFinId(sellerFinId),
                    hashTerm(asset)  // only asset, no settlement
                )));

        } else if (params.primaryType == FinP2P.PrimaryType.PRIVATE_OFFER) {
            return _hashTypedDataV4(params.domain,
                keccak256(abi.encode(
                    PRIVATE_OFFER_TYPE_HASH,
                    keccak256(bytes(nonce)),
                    hashFinId(buyerFinId),
                    hashFinId(sellerFinId),
                    hashTerm(asset),
                    hashTerm(settlement)
                )));

        } else if (params.primaryType == FinP2P.PrimaryType.LOAN) {
            return _hashTypedDataV4(params.domain,
                keccak256(abi.encode(
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

    function hashReceipt(
        FinP2P.Domain memory domain,
        string memory id,
        string memory source,
        string memory destination,
        FinP2P.AssetType assetType,
        string memory assetId,
        string memory quantity
    ) public view returns (bytes32) {
        return _hashTypedDataV4(domain,
            keccak256(abi.encode(
                RECEIPT_TYPE_HASH,
                keccak256(bytes(id)),
                hashSource('finp2p', source),
                hashDestination('finp2p', destination),
                hashAsset(assetId, assetType),
                keccak256(bytes(quantity))
            )));
    }

}