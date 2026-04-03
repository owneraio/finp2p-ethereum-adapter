// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "@owneraio/finp2p-ethereum-token-standard/contracts/AssetStandard.sol";

contract AssetRegistry {

    mapping(bytes32 => address) private assetsStandards;

    function registerAssetStandard(bytes32 standardId, address assetStandard) public {
        require(assetStandard != address(0), "Invalid asset standard address");
        assetsStandards[standardId] = assetStandard;
    }

    function getAssetStandard(bytes32 standardId) public view returns (address) {
        address assetStandard = assetsStandards[standardId];
        require(address(assetStandard) != address(0), "Asset standard not found");
        return assetStandard;
    }
}
