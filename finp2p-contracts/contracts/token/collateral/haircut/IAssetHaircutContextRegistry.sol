// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;



import { IContext } from "../common/IContext.sol";
import { IAssetHaircutRegistryErrors } from "./IAssetHaircutRegistryErrors.sol";
import { IAssetHaircutContext } from "./IAssetHaircutContext.sol";
import { Visibility } from "../common/Visibility.sol";
import { AssetHaircutContextData } from "./AssetHaircutStructs.sol";

/// @title IAssetHaircutContextRegistry interface
/// @notice Interface for the AssetHaircut Registry contract.
/// @dev The AssetHaircut Registry contract is responsible for managing assetHaircuts in the system.
interface IAssetHaircutContextRegistry is IContext, IAssetHaircutRegistryErrors {
    /// @dev Emitted when a new assetHaircut is created.
    /// @param assetHaircut The address of the created assetHaircut.
    /// @param name The name of the created assetHaircut.
    /// @param description The description of the created assetHaircut.
    /// @param controller The address of the assetHaircut controller.
    event AssetHaircutCreatedInRegistry(
        address indexed assetHaircut, string name, string description, address indexed controller
    );

    /// @dev Emitted when a new assetHaircut is updated.
    /// @param assetHaircut The address of the updated assetHaircut.
    /// @param name The name of the updated assetHaircut.
    /// @param description The description of the updated assetHaircut.
    /// @param controller The address of the assetHaircut controller.
    event AssetHaircutUpdated(
        address indexed assetHaircut, string name, string description, address indexed controller
    );

    /// @dev Emitted when a assetHaircut visibility is updated.
    /// @param assetHaircut The address of the assetHaircut.
    /// @param newVisibility The new visibility of the assetHaircut.
    event AssetHaircutVisibilityUpdated(address indexed assetHaircut, Visibility indexed newVisibility);

    /// @dev Creates a new LOCAL assetHaircut.
    /// @param name The name of the assetHaircut to be created.
    /// @param description The description of the assetHaircut to be created.
    /// @param controller The address that will control the assetHaircut.
    /// @return assetHaircut The address of the created assetHaircut.
    /// @notice Reverts with `AssetHaircutAlreadyExists` if the assetHaircut already exists.
    function createAssetHaircutContext(
        string calldata name,
        string calldata description,
        address controller,
        uint8 decimals
    )
        external
        returns (address assetHaircut);

    /// @dev Updates an existing assetHaircut.
    /// @param assetHaircut The address of the assetHaircut to be removed.
    /// @param name The new name of the assetHaircut.
    /// @param description The new description of the assetHaircut.
    /// @notice Reverts with `AssetHaircutNotFound` if the assetHaircut does not exist.
    function updateAssetHaircutContext(
        address assetHaircut,
        string calldata name,
        string calldata description
    )
        external;

    /// @dev Updates the controller of an existing assetHaircut.
    /// @param assetHaircut The address of the assetHaircut to be removed.
    /// @param newController The new controller of the assetHaircut.
    /// @notice Reverts with `AssetHaircutNotFound` if the assetHaircut does not exist.
    function updateAssetHaircutContextController(address assetHaircut, address newController) external;

    /// @notice Updates the visibility of a assetHaircut in the registry
    /// @param assetHaircut Address of the assetHaircut to update visibility
    /// @param newVisibility New visibility of the assetHaircut
//    function updateAssetHaircutContextVisibility(address assetHaircut, Visibility newVisibility) external;

    /// @dev Returns the assetHaircut details for a given assetHaircut address.
    /// @param assetHaircut The address of the assetHaircut.
    /// @return The assetHaircut interface for the given address.
    /// @notice Reverts with `AssetHaircutNotFound` if the assetHaircut does not exist.
    function getAssetHaircutContext(address assetHaircut) external view returns (IAssetHaircutContext);

    /// @notice Returns the assetHaircut details for a given assetHaircut address.
    /// @param assetHaircut The address of the assetHaircut.
    /// @return The assetHaircut data for the given address.
    function getAssetHaircutContextData(address assetHaircut) external view returns (AssetHaircutContextData memory);

    /// @notice Returns the assetHaircut details for a given assetHaircut name.
    /// @param name The name of the assetHaircut.
    /// @return The assetHaircut interface for the given name.
    function getAssetHaircutContextByName(string calldata name) external view returns (IAssetHaircutContext);

    /// @dev Returns the list of all assetHaircut addresses.
    /// @return An array of all assetHaircut addresses.
    function getAssetHaircutContexts() external view returns (address[] memory);

    /// @notice Checks if a assetHaircut exists in the registry.
    /// @param assetHaircut The address of the assetHaircut to check.
    /// @return bool True if the assetHaircut is present, false otherwise.
    function doesAssetHaircutContextExist(address assetHaircut) external view returns (bool);

    /// @notice Checks if a assetHaircut exists in the registry for a specific controller
    /// @param assetHaircut The address of the assetHaircut to check
    /// @param controller The address of the controller
    /// @return bool True if the assetHaircut is present, false otherwise
    function doesAssetHaircutContextExistForController(
        address assetHaircut,
        address controller
    )
        external
        view
        returns (bool);

    /// @notice Retrieves the assetHaircut address by its name and controller
    /// @param name The name of the assetHaircut
    /// @param controller The address of the controller
    /// @return assetHaircutContextAddress The address of the assetHaircut
    function getAssetHaircutContextByNameAndController(
        string calldata name,
        address controller
    )
        external
        view
        returns (address assetHaircutContextAddress);
}
