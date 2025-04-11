// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import "../IAssetCollateralAccount.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPriceService} from "./IPriceService.sol";
import {IHaircutService} from "./IHaircutService.sol";

contract AssetCollateralAccountMock is IAssetCollateralAccount {

    CollateralType private _collateralType;
    uint8 private _decimals;
    address private _borrower;
    address private _lender;
    address private _liabilityOwner;
    uint256 private _amountKept;

    int256 private _targetRatio;
    uint256 private _targetRatioLimit;
    int256 private _defaultRatio;
    uint256 private _defaultRatioLimit;
    uint256 private _priceType;
    address private _haircutContext;
    address private _priceService;
    address private _pricedInToken;
    LiabilityData private _liabilityData;
    address[] private _assetContextList;

    struct Lock {
        address tokenAddress;
        uint256 amount;
    }

    Lock[] private _locks;

    constructor(
        CollateralType collateralType,
        uint8 decimals,
        address borrower,
        address lender
    ) {
        _collateralType = collateralType;
        _decimals = decimals;
        _borrower = borrower;
        _lender = lender;
        _liabilityOwner = address(this);
        _amountKept = 0;
    }

    function setAllowableCollateral(
        Asset[] memory assetList
    ) external {
//        assetContextList = assetList;
    }

    function getAllowableCollateral() external view returns (Asset[] memory) {
        Asset[] memory assets = new Asset[](0);
        return assets;
    }

    function setPricedItemConfiguration(
        address _priceService,
        address _pricedInToken,
        uint256 _priceType
    ) external {
        _priceService = _priceService;
        _pricedInToken = _pricedInToken;
        _priceType = _priceType;
    }

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
    ) external {
        _targetRatio = targetRatio;
        _defaultRatio = defaultRatio;
        _targetRatioLimit = targetRatioLimit;
        _defaultRatioLimit = defaultRatioLimit;
        _priceType = priceType;
        _haircutContext = haircutContext;
        _priceService = priceService;
        _pricedInToken = pricedInToken;
        _liabilityData = liabilityData;
        _assetContextList = assetContextList;
    }

    function processInterval(uint256 triggerId, uint256 timestamp) external {}

    function deposit(Asset memory asset, uint256 amount) external {

//        uint256 price = IPriceService(priceService).getAssetRate(_asset.addr);
//        uint256 haircut = IHaircutService(haircutContext).getAssetHaircut(_asset.addr);
//        uint256 baseValue = price * _amount / 1e18;
//        uint256 valueAfterHaircut = baseValue * (100 - haircut) / 100;
        require(msg.sender == _borrower, "Only source can deposit");

        IERC20(asset.addr).transferFrom(_borrower, _liabilityOwner, amount);
        _locks.push(Lock(asset.addr, amount));

//        amountKept += valueAfterHaircut;
    }

    /// @notice [permission] controller or Role:EscrowAgent
    function release() external {
        for (uint i = 0; i < _locks.length; i++) {
            require(_locks[i].amount > 0, "Lock is not active");
            IERC20(_locks[i].tokenAddress).transferFrom(_liabilityOwner, _borrower, _locks[i].amount);
            _locks[i].amount = 0;
        }
    }

    function forward() external {
        for (uint i = 0; i < _locks.length; i++) {
            require(_locks[i].amount > 0, "Lock is not active");
            IERC20(_locks[i].tokenAddress).transferFrom(_liabilityOwner, _lender, _locks[i].amount);
            _locks[i].amount = 0;
        }
    }


    function partialRelease(Asset[] calldata _assets, uint256[] calldata _amounts) external {
        for (uint i = 0; i < _assets.length; i++) {
            require(_locks[i].amount > _amounts[i], "Amount exceeds lock");
            IERC20(_assets[i].addr).transferFrom(_liabilityOwner, _borrower, _amounts[i]);
            _locks[i].amount -= _amounts[i];
        }
    }

    function partialForward(Asset[] calldata _assets, uint256[] calldata _amounts) external {
        for (uint i = 0; i < _assets.length; i++) {
            require(_locks[i].amount > _amounts[i], "Amount exceeds lock");
            IERC20(_assets[i].addr).transferFrom(_liabilityOwner, _lender, _amounts[i]);
            _locks[i].amount -= _amounts[i];
        }
    }

    function getHaircutContext() external view returns (address) {
        return _haircutContext;
    }

    function source() external view returns (address) {
        return _borrower;
    }

    function destination() external view returns (address) {
        return _lender;
    }
}


