// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;


struct StrategyInput {
    address[] assetContextList;
    address[] addressList;
}

struct LiabilityData {
    address liabilityAddress;
    uint256 amount;
    address pricedInToken;
    uint256 effectiveTime;
}
