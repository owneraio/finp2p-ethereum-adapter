// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;


interface IHaircutService {

    struct Haircut {
        address asset;
        uint256 rate;
    }

    function setAssetHaircut(
        address asset,
        uint256 haircut
    ) external;

    function getAssetHaircut(
        address asset
    ) external returns (uint256);
}