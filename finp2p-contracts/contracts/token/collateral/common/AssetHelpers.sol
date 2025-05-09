// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;


enum AssetStandard {
    NETWORK, //ETHER,
    FUNGIBLE, //ERC20,
    NON_FUNGIBLE, //ERC721,
    PART_FUNGIBLE, //ERC1155,
    ITEM, //Composer non-fungible item
    OTHER
}

struct Asset {
    AssetStandard standard;
    address addr;
    uint256 tokenId;
}