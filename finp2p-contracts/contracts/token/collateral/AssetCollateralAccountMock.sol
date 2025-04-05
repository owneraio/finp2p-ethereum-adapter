// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import "./IAssetCollateralAccount.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract AssetCollateralAccountMock is IAssetCollateralAccount {

    address private source;
    address private destination;
    address private liabilityOwner;
    uint256 private amountKept;

    struct Lock {
        address tokenAddress;
        uint256 amount;
    }

    Lock[] private locks;

    constructor(
        address _source,
        address _destination
    ) {
        source = _source;
        destination = _destination;
        liabilityOwner = address(this);
        amountKept = 0;
    }

    function setAllowableCollateral(
        address[] memory assetList
    ) external {
    }

    function setPricedItemConfiguration(
        address priceService,
        address pricedInToken,
        uint256 priceType
    ) external {
    }

    function setConfigurationBundle(
        uint256 targetRatio,
        uint256 defaultRatio,
        uint256 targetRatioLimit,
        uint256 defaultRatioLimit,
        uint256 priceType,
        address haircutContext,
        address priceService,
        address pricedInToken,
        LiabilityData memory liabilityData,
        address[] memory assetContextList
    ) external {
    }

    function processInterval(uint256 triggerId, uint256 timestamp) external {}

    function deposit(Asset calldata _asset, uint256 _amount) external {
        IERC20(_asset.addr).transferFrom(source, liabilityOwner, _amount);
        locks.push(Lock(_asset.addr, _amount));
        amountKept += _amount;
    }

    /// @notice [permission] controller or Role:EscrowAgent
    function release() external {
        for (uint i = 0; i < locks.length; i++) {
            IERC20(locks[i].tokenAddress).transferFrom(liabilityOwner, destination, locks[i].amount);
        }
    }

    function forward() external {
        for (uint i = 0; i < locks.length; i++) {
            IERC20(locks[i].tokenAddress).transferFrom(liabilityOwner, source, locks[i].amount);
        }
    }



    function partialRelease(Asset[] calldata _assets, uint256[] calldata _amounts) external {
        for (uint i = 0; i < _assets.length; i++) {
            IERC20(_assets[i].addr).transferFrom(liabilityOwner, destination, _amounts[i]);
        }
    }

    function partialForward(Asset[] calldata _assets, uint256[] calldata _amounts) external {
        for (uint i = 0; i < _assets.length; i++) {
            IERC20(_assets[i].addr).transferFrom(liabilityOwner, source, _amounts[i]);
        }
    }

}


