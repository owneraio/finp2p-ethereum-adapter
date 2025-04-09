// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import "../IAccountFactory.sol";
import "../IAssetCollateralAccount.sol";
import "./AssetCollateralAccountMock.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract AccountFactoryMock is IAccountFactory {

    address private _controller;

    function addAccountStrategy(address accountStrategy) external {

    }

    function createAccount(
        string calldata name,
        string calldata description,
        bytes32 accountStandard,
        address controller_,
        bytes calldata initParams,
        StrategyInput calldata strategyInput
    ) external returns (address) {
        _controller = controller_;
        (uint8 decimals, uint8 collateralTypeRaw, uint8 reserved1, uint8 reserved2) =
                            abi.decode(initParams, (uint8, uint8, uint8, uint8));

        IAssetCollateralAccount.CollateralType collateralType = IAssetCollateralAccount.CollateralType(collateralTypeRaw);

//        address[] assetContextList = strategyInput.assetContextList;

        require(strategyInput.addressList.length == 3, "Invalid address list length");
        address source = strategyInput.addressList[0];
        address destination = strategyInput.addressList[1];
        address liabFactor = strategyInput.addressList[2];

        IAssetCollateralAccount _collateral = new AssetCollateralAccountMock(
            collateralType, decimals, source, destination);
//        _collateral.setAllowableCollateral(strategyInput.assetContextList);

        emit AccountCreated(address(_collateral), 0, address(0), "", "", bytes32(0));
        return address(_collateral);
    }

    function getAccountIssuer(address account) external view returns (address) {
        return address(0);
    }

    function getAccountStandard(address accountAddress) external view returns (bytes32) {
        return bytes32(0);
    }

    function getIssuedAccounts(bytes32 standard, uint256 start, uint256 length) external view returns (address[] memory) {
        address[] memory accounts = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            accounts[i] = address(0);
        }
        return accounts;
    }

    function getIssuedAccountsTotal(bytes32 standard) external view returns (uint256) {
        return 0;
    }

    function getLiabilityFactory() external view returns (address) {
        return address(0);
    }

    function getSupportedStandardsLength() external view returns (uint256) {
        return 0;
    }

    function initialize(
        string calldata name,
        string calldata description,
        address updatesRepository,
        address dataContextFactoryAddress,
        address propertyRegistry,
        address liabilityFactory,
        address controller_
    ) external {

    }

    function isSupported(bytes32 standard) external view returns (bool) {
        return false;
    }

    function removeAccountStrategy(bytes32 standard) external {

    }

    function updateAccountStrategy(address accountStrategyNew) external {

    }

    function controller() external view returns (address) {
        return _controller;
    }


}


