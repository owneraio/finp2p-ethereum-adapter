// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "./AssetStandard.sol";

contract AssetRegistry {

    mapping(uint16 => address) private assetsStandards;

    function registerAssetStandard(uint16 standardId, address assetStandard) public {
        require(assetStandard != address(0), "Invalid asset standard address");
        assetsStandards[standardId] = assetStandard;
    }

    function getAssetStandard(uint16 standardId) public view returns (address) {
        address assetStandard = assetsStandards[standardId];
        require(address(assetStandard) != address(0), "Asset standard not found");
        return assetStandard;
    }
}
