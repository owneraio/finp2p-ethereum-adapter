// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

struct AssetPriceContextData {
    bool foo;
}

enum PriceType {
    DEFAULT,
    MARKET,
    BID,
    ASK,
    NAV,
    NPV,
    LIQUIDATION
}