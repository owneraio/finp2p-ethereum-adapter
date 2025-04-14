// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../../../utils/finp2p/FinP2PSignatureVerifier.sol";
import {PriceType} from "../price/AssetPriceStructs.sol";

interface IFinP2PCollateralBasketFactory {

    enum CollateralBasketState {
        CREATED,
        WITHHELD,
        OPENED,
        CLOSED,
        REVERSED,
        RELEASED
    }

    /// @notice Collateral Account parameters
    /// @param targetRatio Defines the desired collateralization ratio (in basis points)
    /// @param defaultRatio Defines the minimum collateralization ratio (in basis points) below which a Collateral Agreement is considered in "Default"
    /// @param targetRatioLimit Specifies how many consecutive times a Collateral Agreement can fall below the target ratio before being considered in Default (example = 2)
    /// @param defaultRatioLimit Specifies how many consecutive times a Collateral Agreement can fall below the default ratio before officially entering the "Default" state ple = 2)
    /// @param priceType The type of price used for the collateral agreement
    /// @param haircutContext Address of the smart contract managing haircut logic for this Collateral Agreement, registered via the Haircut Context Registry
    /// @param priceService Address of the smart contract managing pricing logic for this Collateral Agreement, registered via the Pricing Context Registry,
    /// @param pricedInToken The asset (typically an ERC20 token) used to price this Collateral Agreement—for example, USD, JPY, or EUR.
    /// @param liabilityAmount The amount of liability associated with the collateral agreement
    /// @param liabilityAddress If the liabilityAddress passed to setAllowableCollateral is the zero address, the Collateral Agreement will automatically create the corresponding Liability Item.
    /// @param assetContextList List of other Collateral Agreements to inherit allowable (whitelisted) assets from, reducing the need to call setAllowableCollateral manually.
    struct CollateralAssetParameters {
//        int256 targetRatio;
//        int256 defaultRatio;
//        int256 targetRatioLimit;
//        int256 defaultRatioLimit;
//        PriceType priceType;
        address controller;
        address haircutContext;
        address priceService;
        address pricedInToken;
        int256 liabilityAmount;
//        address liabilityAddress;
//        address[] assetContextList;
    }

    function createCollateralAsset(
        string memory name,
        string memory description,
        string memory basketId,
        address[] memory tokenAddresses,
        string[] memory quantities,
        string memory sourceFinId,
        string memory destinationFinId,
        CollateralAssetParameters memory config
    ) external;

    function associateCollateralAsset(
        string memory basketId,
        address[] memory tokenAddresses,
        string[] memory quantities,
        string memory borrower,
        string memory lender,
        address collateralAccount
    ) external;

    function getBasketAccount(string memory basketId) external view returns (address);

    function getBasketState(string memory basketId) external view returns (CollateralBasketState);

    function getBasketTokens(string memory basketId) external view returns (address[] memory);

    function getBasketAmounts(string memory basketId) external view returns (uint256[] memory);

    function getEscrowBorrower() external view returns (address);

    function getEscrowLender() external view returns (address);
}