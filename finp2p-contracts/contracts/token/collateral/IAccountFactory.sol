// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

interface IAccountFactory {

    function createAccount(
        string memory name,
        string memory description,
        bytes32 strategyId,
        address controller,
        bytes memory initParams,
        bytes memory strategyInput
    ) external returns (address);

}