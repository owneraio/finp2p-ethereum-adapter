// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import "../IAssetCollateralAccount.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPriceService} from "./IPriceService.sol";
import {IHaircutService} from "./IHaircutService.sol";

contract AssetCollateralAccountMock is IAssetCollateralAccount {

    CollateralType private collateralType;
    uint8 private decimals;
    address private _source;
    address private _destination;
    address private liabilityOwner;
    uint256 private amountKept;

    int256 private targetRatio;
    uint256 private targetRatioLimit;
    int256 private defaultRatio;
    uint256 private defaultRatioLimit;
    uint256 private priceType;
    address private haircutContext;
    address private priceService;
    address private pricedInToken;
    LiabilityData  private liabilityData;
    address [] private assetContextList;

    struct Lock {
        address tokenAddress;
        uint256 amount;
    }

    Lock[] private locks;

    constructor(
        CollateralType _collateralType,
        uint8 _decimals,
        address _source,
        address _destination
    ) {
        collateralType = _collateralType;
        decimals = _decimals;
        _source = _source;
        _destination = _destination;
        liabilityOwner = address(this);
        amountKept = 0;
    }

    function setAllowableCollateral(
        address[] memory assetList
    ) external {
    assetContextList = assetList;
    }

    function setPricedItemConfiguration(
        address _priceService,
        address _pricedInToken,
        uint256 _priceType
    ) external {
        priceService = _priceService;
        pricedInToken = _pricedInToken;
        priceType = _priceType;
    }

    function setConfigurationBundle(
        int256 _targetRatio,
        int256 _defaultRatio,
        uint256 _targetRatioLimit,
        uint256 _defaultRatioLimit,
        uint256 _priceType,
        address _haircutContext,
        address _priceService,
        address _pricedInToken,
        LiabilityData memory _liabilityData,
        address[] memory _assetContextList
    ) external {
        targetRatio = _targetRatio;
        defaultRatio = _defaultRatio;
        targetRatioLimit = _targetRatioLimit;
        defaultRatioLimit = _defaultRatioLimit;
        priceType = _priceType;
        haircutContext = _haircutContext;
        priceService = _priceService;
        pricedInToken = _pricedInToken;
        liabilityData = _liabilityData;
        assetContextList = _assetContextList;
    }

    function processInterval(uint256 triggerId, uint256 timestamp) external {}

    function deposit(Asset calldata _asset, uint256 _amount) external {

//        uint256 price = IPriceService(priceService).getAssetRate(_asset.addr);
//        uint256 haircut = IHaircutService(haircutContext).getAssetHaircut(_asset.addr);
//        uint256 baseValue = price * _amount / 1e18;
//        uint256 valueAfterHaircut = baseValue * (100 - haircut) / 100;


        IERC20(_asset.addr).transferFrom(_source, liabilityOwner, _amount);
        locks.push(Lock(_asset.addr, _amount));

//        amountKept += valueAfterHaircut;
    }

    /// @notice [permission] controller or Role:EscrowAgent
    function release() external {
        for (uint i = 0; i < locks.length; i++) {
            require(locks[i].amount > 0, "Lock is not active");
            IERC20(locks[i].tokenAddress).transferFrom(liabilityOwner, _source, locks[i].amount);
            locks[i].amount = 0;
        }
    }

    function forward() external {
        for (uint i = 0; i < locks.length; i++) {
            require(locks[i].amount > 0, "Lock is not active");
            IERC20(locks[i].tokenAddress).transferFrom(liabilityOwner, _destination, locks[i].amount);
            locks[i].amount = 0;
        }
    }


    function partialRelease(Asset[] calldata _assets, uint256[] calldata _amounts) external {
        for (uint i = 0; i < _assets.length; i++) {
            require(locks[i].amount > _amounts[i], "Amount exceeds lock");
            IERC20(_assets[i].addr).transferFrom(liabilityOwner, _source, _amounts[i]);
            locks[i].amount -= _amounts[i];
        }
    }

    function partialForward(Asset[] calldata _assets, uint256[] calldata _amounts) external {
        for (uint i = 0; i < _assets.length; i++) {
            require(locks[i].amount > _amounts[i], "Amount exceeds lock");
            IERC20(_assets[i].addr).transferFrom(liabilityOwner, _destination, _amounts[i]);
            locks[i].amount -= _amounts[i];
        }
    }

    function getHaircutContext() external view returns (address) {
        return haircutContext;
    }

    function source() external view returns (address) {
        return _source;
    }

    function destination() external view returns (address) {
        return _destination;
    }
}


