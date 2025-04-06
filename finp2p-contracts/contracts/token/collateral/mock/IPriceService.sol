// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;


interface IPriceService {

    struct AssetRate {
        address asset;
        address pricedInToken;
        uint256 rate;
    }

    function setAssetRate(
        address asset,
        address pricedInToken,
        uint256 rate
    ) external;

    function getAssetRate(
        address asset
    ) external returns (uint256);
}