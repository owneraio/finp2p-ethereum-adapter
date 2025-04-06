// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import "./IPriceService.sol";
import {IHaircutService} from "./IHaircutService.sol";


contract PriceServiceMock is IHaircutService {

    mapping(address => Haircut) private haircuts;

    function setAssetHaircut(
        address asset,
        uint256 haircut
    ) override external {
        haircuts[asset] = Haircut(
            asset,
            haircut
        );
    }

    function getAssetHaircut(
        address asset
    ) override external view returns (uint256) {
        Haircut storage haircut = haircuts[asset];
        return haircut.rate;
    }
}


