// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

interface IAccountFactory {

    function controller() external view returns (address);

    struct LiabilityData {
        address liabilityAddress;
        uint256 amount;
        address pricedInToken;
        uint256 effectiveTime;
    }

    struct StrategyInput {
        address[] assetContextList;
        address[] addressList;
        uint256[] amountList;
        uint256[] effectiveTimeList;
        LiabilityData[] liabilityDataList;
    }

    function createAccount(
        string memory name,
        string memory description,
        bytes32 strategyId,
        address controller,
        bytes memory initParams,
        StrategyInput memory strategyInput
    ) external returns (address);

    function getLiabilityFactory() external view returns (address);

}