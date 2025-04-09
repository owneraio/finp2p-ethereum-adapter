// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {Asset} from "./common/AssetHelpers.sol";
import {LiabilityData} from "./common/StrategyInput.sol";

interface IAssetCollateralAccount {

    enum CollateralType {
        CCP_MARGIN,
        REPO
    }

    function setAllowableCollateral(
        address[] memory assetList
    ) external;

    function setPricedItemConfiguration(
        address priceService,
        address pricedInToken,
        uint256 priceType
    ) external;

    function setConfigurationBundle(
        int256 targetRatio,
        int256 defaultRatio,
        uint256 targetRatioLimit,
        uint256 defaultRatioLimit,
        uint256 priceType,
        address haircutContext,
        address priceService,
        address pricedInToken,
        LiabilityData memory liabilityData,
        address[] memory assetContextList
    ) external;

    function processInterval(uint256 triggerId, uint256 timestamp) external;

    function deposit(Asset calldata _asset, uint256 _amount) external;

    event EscrowReleased(address _source);
    event EscrowForwarded(address _destination);

    /// @notice [permission] controller or Role:EscrowAgent
    function release() external; //send assets back to source (borrower) when the obligation is met

    function forward() external; //send assets to destination (lender – usually on default)

    function partialForward(Asset[] calldata _assets, uint256[] calldata _amounts) external;

    function partialRelease(Asset[] calldata _assets, uint256[] calldata _amounts) external;

    function getHaircutContext() external view returns (address);

    function source() external view returns (address);

    function destination() external view returns (address);

//    function getLiabilityItem() external view returns (address);
//
//    function getPriceContext() external view returns (address);
//
////    function getStatus() external view returns (Status);
//
//    function getStartDate() external view returns (uint256);
//
//    function getEndDate() external view returns (uint256);
}