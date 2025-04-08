// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;


import { IContext } from "../common/IContext.sol";
import { IDecimals } from "../common/IDecimals.sol";

interface IPriceContextErrors {
    error PricedInCannotBeZeroAddress();
    error PriceTypeAlreadyAdded(address priceType);
    error PriceTypeNotFound(address priceType);
    error PriceTypeAlreadyExists(string name);
    error PriceTypeAlreadyExistsInRegistry(string name);
    error PriceTypeNameExists();
    error InvalidPriceTypeAddress(address priceType);
    error PriceTypeNotRegistered(address priceType);
    error PriceTypeRegistryNotSet();
    error ControllerAlreadyHasPriceContext(address priceContext);
}

/// @title IPriceContext interface
/// @notice The logic should be implemented as a separate service from the other elements.
/// NOTE: There is a related IAssetPriceContext interface that allows the storage of prices for any asset
///      - not just fungible assets
/// NOTE: May have a Role Context since the interface is a IRoleAgency. This allows RBAC control of how data is
/// governed.
/// NOTE: Null asset means network token (ETH or other token with no smart contract)
/// NOTE: see IRateContext for the pattern. RateType = null means default
interface IPriceContext is IPriceContextErrors, IContext, IDecimals {
    //events
    event RateChanged(address pricedAsset, address pricedIn, address priceType, int256 rate);
    event DefaultRateChanged(address pricedAsset, address pricedIn, int256 rate);

    event PriceTypeCreated(address priceType, string name, string description, address controller);
    event PriceTypeAdded(address priceType, string name, string description, address controller);
    event PriceTypeRemoved(address priceType, address context);

    //setters

    //sets the default price. null asset means network token
    function setRate(address asset, address pricedIn, int256 rate) external;

    function setRateByType(address asset, address pricedIn, address priceType, int256 rate) external;

    function setDefaultRateForPair(address asset, address pricedIn, address priceType) external;

    function createPriceType(
        string calldata name,
        string calldata description,
        address controller
    )
        external
        returns (address);

    function addPriceType(address) external;

    function removePriceType(address) external;

    //getters
    function getRate(address asset, address pricedIn) external view returns (int256); //this returns default price

    function getRateByType(address asset, address pricedIn, address priceType) external view returns (int256);

    function getPriceTypes() external view returns (address[] memory); //return a list of price types for the context
}
