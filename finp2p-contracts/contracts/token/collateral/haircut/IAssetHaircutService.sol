// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {IDecimals} from "../common/IDecimals.sol";
import {Asset} from "../common/AssetHelpers.sol";

/// @title IAssetHaircutService
/// @notice Interface for services used to provide haircut data for assets
/// @dev A haircut represents the discount applied to the price of the asset based on expected friction in liquidating
/// the asset in the event of default. The logic for this service should be implemented separately from other services.
interface IAssetHaircutService is IDecimals {
    /// @notice Returns whether an asset has a haircut
    /// @param _asset The asset for which the haircut is checked
    /// @return exists Whether the asset has a haircut
    function hasAssetHaircut(Asset calldata _asset) external view returns (bool exists);

    /// @notice Returns the haircut of an asset
    /// @param asset The asset for which the haircut is returned
    /// @return haircut The haircut value as a percentage with the haircut's decimal precision
    function getAssetHaircut(Asset calldata asset) external view returns (uint256 haircut);

    /// @notice Returns the haircuts of multiple assets
    /// @param assets The assets for which the haircuts are returned
    /// @return haircuts The haircut values as percentages with the haircut's decimal precision
    function getAssetHaircuts(Asset[] calldata assets) external view returns (uint256[] memory haircuts);

    /// @notice Returns the retention of a haircut for a given asset
    /// @param asset The asset for which the haircut retention is returned
    /// @return haircut The haircut value as a percentage with the haircut's decimal precision
    function getAssetHaircutDiscount(Asset calldata asset) external view returns (uint256 haircut);

    /// @notice Returns the retentions of haircuts for multiple assets
    /// @param assets The assets for which the haircut retentions are returned
    /// @return haircuts The haircut values as percentages with the haircut's decimal precision
    function getAssetHaircutDiscounts(Asset[] calldata assets) external view returns (uint256[] memory haircuts);
}
