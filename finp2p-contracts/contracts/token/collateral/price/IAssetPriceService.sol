// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;


import { IPriceServiceErrors } from "./IPriceService.sol";
import { IDecimals } from "../common/IDecimals.sol";
import { Asset } from "../common/AssetHelpers.sol";

interface IAssetPriceServiceErrors is IPriceServiceErrors {
    /// @notice Error thrown when the asset is not valid for a price
    error AssetNotValidForPrice();

    /// @notice Error thrown when the asset address is zero
    error AssetCannotBeZeroAddress();

    /// @notice Error thrown when the assets and Prices length mismatch
    error AssetsAndPricesLengthMismatch();
}

/// @title IAssetPriceService
/// @notice Interface for services used to provide price data for assets
/// @dev A price represents the discount applied to the price of the asset based on expected friction in liquidating
/// the asset in the event of default. The logic for this service should be implemented separately from other services.
interface IAssetPriceService is IDecimals, IAssetPriceServiceErrors {
    //events
    event AssetRateChanged(Asset _pricedAsset, address _pricedIn, address _priceType, int256 _price);
    event AssetDefaultRateChanged(Asset _pricedAsset, address _pricedIn, int256 _price);
    event AssetPricePairRemoved(Asset _pricedAsset, address _pricedIn, address _priceType);
    event AssetDefaultRateRemoved(Asset _pricedAsset, address _pricedIn);

    //setters
    function setAssetRate(Asset calldata asset, address pricedIn, int256 rate) external; //sets the default price

    function setAssetRateByType(Asset calldata asset, address pricedIn, address priceType, int256 rate) external;

    function setAssetDefaultRateForPair(Asset calldata asset, address pricedIn, address priceType) external;

    function removeAssetPricePair(Asset calldata asset, address pricedIn, address priceType) external;

    /// @notice Removes the default rate of an asset
    /// @param asset The asset to remove the rate for
    /// @param pricedIn The address of the asset the rate is priced in
    function removeAssetRate(Asset calldata asset, address pricedIn) external;

    //getters
    function getAssetRate(Asset calldata asset, address pricedIn) external view returns (int256); //returns default
        // price

    function batchGetAssetRates(
        Asset[] calldata assets,
        address[] calldata pricedIns
    )
        external
        view
        returns (int256[] memory);

    function getAssetRateByType(
        Asset calldata asset,
        address pricedIn,
        address priceType
    )
        external
        view
        returns (int256);
}
