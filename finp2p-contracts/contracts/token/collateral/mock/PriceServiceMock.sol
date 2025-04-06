// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import "./IPriceService.sol";


contract PriceServiceMock is IPriceService {

    mapping(address => AssetRate) private assetRates;

    function setAssetRate(
        address asset,
        address pricedInToken,
        uint256 rate
    ) override external {
        assetRates[asset] = AssetRate(
            asset,
            pricedInToken,
            rate
        );
    }

    function getAssetRate(
        address asset
    ) override external view returns (uint256) {
        AssetRate storage rate = assetRates[asset];
        return rate.rate;
    }
}


