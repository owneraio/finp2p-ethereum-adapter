// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

library FinP2P {

    enum Phase {
        INITIATE,
        CLOSE
    }

    enum ReleaseType {
        RELEASE,
        REDEEM
    }

    struct Domain {
        uint256 chainId;
        address verifyingContract;
    }

    struct OperationParams {
        Domain domain;
        PrimaryType primaryType;
        LegType leg;
        Phase phase;
        string operationId;
        ReleaseType releaseType;
    }

    enum AssetType {
        FINP2P,
        FIAT,
        CRYPTOCURRENCY
    }

    enum LegType {
        ASSET,
        SETTLEMENT
    }

    enum PrimaryType {
        PRIMARY_SALE,
        BUYING,
        SELLING,
        REDEMPTION,
        REQUEST_FOR_TRANSFER,
        PRIVATE_OFFER,
        LOAN
    }

    struct Term {
        string assetId;
        AssetType assetType;
        string amount;
    }

    struct LoanTerm {
        string openTime;
        string closeTime;
        string borrowedMoneyAmount;
        string returnedMoneyAmount;
    }

    struct Asset {
        string id;
        address tokenAddress;
    }

    struct Lock {
        string assetId;
        FinP2P.AssetType assetType;
        string source;
        string destination;
        string amount;
    }

    struct LockInfo {
        string assetId;
        FinP2P.AssetType assetType;
        string source;
        string destination;
        string amount;
    }

    /// @notice Extract the direction of the operation
    /// @param sellerFinId The FinID of the seller
    /// @param buyerFinId The FinID of the buyer
    /// @param assetTerm The asset term
    /// @param settlementTerm The settlement term
    /// @param op The operation parameters
    /// @return The source FinID, the destination FinID, the asset id, the asset type, the amount
    function extractDetails(
        string memory sellerFinId,
        string memory buyerFinId,
        FinP2P.Term memory assetTerm,
        FinP2P.Term memory settlementTerm,
        FinP2P.OperationParams memory op
    ) internal pure returns (string memory, string memory, string memory, FinP2P.AssetType, string memory) {
        if (op.leg == FinP2P.LegType.ASSET) {
            if (op.phase == FinP2P.Phase.INITIATE) {
                return (sellerFinId, buyerFinId, assetTerm.assetId, assetTerm.assetType, assetTerm.amount);
            } else if (op.phase == FinP2P.Phase.CLOSE) {
                return (buyerFinId, sellerFinId, assetTerm.assetId, assetTerm.assetType, assetTerm.amount);
            } else {
                revert("Invalid phase");
            }
        } else if (op.leg == FinP2P.LegType.SETTLEMENT) {
            if (op.phase == FinP2P.Phase.INITIATE) {
                return (buyerFinId, sellerFinId, settlementTerm.assetId, settlementTerm.assetType, settlementTerm.amount);
            } else if (op.phase == FinP2P.Phase.CLOSE) {
                return (sellerFinId, buyerFinId, settlementTerm.assetId, settlementTerm.assetType, settlementTerm.amount);
            } else {
                revert("Invalid phase");
            }
        } else {
            revert("Invalid leg");
        }
    }

}