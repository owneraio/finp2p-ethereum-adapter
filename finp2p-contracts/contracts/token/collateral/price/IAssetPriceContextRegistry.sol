// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;


import { IContext } from "../common/IContext.sol";
import { IAssetPriceRegistryErrors } from "./IAssetPriceRegistryErrors.sol";
import { IAssetPriceContext } from "./IAssetPriceContext.sol";
import { Visibility } from "../common/Visibility.sol";
import { AssetPriceContextData } from "./AssetPriceStructs.sol";

/// @title IAssetPriceContextRegistry interface
/// @notice Interface for the AssetPrice Registry contract.
/// @dev The AssetPrice Registry contract is responsible for managing assetPrices in the system.
interface IAssetPriceContextRegistry is IContext, IAssetPriceRegistryErrors {
    /// @dev Emitted when a new assetPrice is created.
    /// @param assetPrice The address of the created assetPrice.
    /// @param name The name of the created assetPrice.
    /// @param description The description of the created assetPrice.
    /// @param controller The address of the assetPrice controller.
    event AssetPriceCreatedInRegistry(
        address indexed assetPrice, string name, string description, address indexed controller
    );

    /// @dev Emitted when a new assetPrice is updated.
    /// @param assetPrice The address of the updated assetPrice.
    /// @param name The name of the updated assetPrice.
    /// @param description The description of the updated assetPrice.
    /// @param controller The address of the assetPrice controller.
    event AssetPriceUpdated(address indexed assetPrice, string name, string description, address indexed controller);

    /// @dev Emitted when a assetPrice visibility is updated.
    /// @param assetPrice The address of the assetPrice.
    /// @param newVisibility The new visibility of the assetPrice.
//    event AssetPriceVisibilityUpdated(address indexed assetPrice, Visibility indexed newVisibility);

    /// @dev Creates a new LOCAL assetPrice.
    /// @param name The name of the assetPrice to be created.
    /// @param description The description of the assetPrice to be created.
    /// @param controller The address that will control the assetPrice.
    /// @return assetPrice The address of the created assetPrice.
    /// @notice Reverts with `AssetPriceAlreadyExists` if the assetPrice already exists.
    function createAssetPriceContext(
        string calldata name,
        string calldata description,
        address controller,
        uint8 decimals
    )
        external
        returns (address assetPrice);

    /// @dev Updates an existing assetPrice.
    /// @param assetPrice The address of the assetPrice to be removed.
    /// @param name The new name of the assetPrice.
    /// @param description The new description of the assetPrice.
    /// @notice Reverts with `AssetPriceNotFound` if the assetPrice does not exist.
    function updateAssetPriceContext(address assetPrice, string calldata name, string calldata description) external;

    /// @dev Updates the controller of an existing assetPrice.
    /// @param assetPrice The address of the assetPrice to be removed.
    /// @param newController The new controller of the assetPrice.
    /// @notice Reverts with `AssetPriceNotFound` if the assetPrice does not exist.
    function updateAssetPriceContextController(address assetPrice, address newController) external;

    /// @notice Updates the visibility of a assetPrice in the registry
    /// @param assetPrice Address of the assetPrice to update visibility
    /// @param newVisibility New visibility of the assetPrice
    function updateAssetPriceContextVisibility(address assetPrice, Visibility newVisibility) external;

    /// @dev Returns the assetPrice details for a given assetPrice address.
    /// @param assetPrice The address of the assetPrice.
    /// @return The assetPrice interface for the given address.
    /// @notice Reverts with `AssetPriceNotFound` if the assetPrice does not exist.
    function getAssetPriceContext(address assetPrice) external view returns (IAssetPriceContext);

    /// @notice Returns the assetPrice details for a given assetPrice address.
    /// @param assetPrice The address of the assetPrice.
    /// @return The assetPrice data for the given address.
    function getAssetPriceContextData(address assetPrice) external view returns (AssetPriceContextData memory);

    /// @notice Returns the assetPrice details for a given assetPrice name.
    /// @param name The name of the assetPrice.
    /// @return The assetPrice interface for the given name.
    function getAssetPriceContextByName(string calldata name) external view returns (IAssetPriceContext);

    /// @dev Returns the list of all assetPrice addresses.
    /// @return An array of all assetPrice addresses.
    function getAssetPriceContexts() external view returns (address[] memory);

    /// @notice Checks if a assetPrice exists in the registry.
    /// @param assetPrice The address of the assetPrice to check.
    /// @return bool True if the assetPrice is present, false otherwise.
    function doesAssetPriceContextExist(address assetPrice) external view returns (bool);

    /// @notice Checks if a assetPrice exists in the registry for a specific controller
    /// @param assetPrice The address of the assetPrice to check
    /// @param controller The address of the controller
    /// @return bool True if the assetPrice is present, false otherwise
    function doesAssetPriceContextExistForController(
        address assetPrice,
        address controller
    )
        external
        view
        returns (bool);

    /// @notice Retrieves the assetPrice address by its name and controller
    /// @param name The name of the assetPrice
    /// @param controller The address of the controller
    /// @return assetPriceContextAddress The address of the assetPrice
    function getAssetPriceContextByNameAndController(
        string calldata name,
        address controller
    )
        external
        view
        returns (address assetPriceContextAddress);
}
