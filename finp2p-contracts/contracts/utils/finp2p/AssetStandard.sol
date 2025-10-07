// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "./OperationParams.sol";

interface AssetStandard {

    function balanceOf(address tokenAddress, address account) external view returns (string memory);

    function transferFrom(address tokenAddress, address from, address to, string memory value, OperationParams memory op) external returns (bool);

    function mint(address tokenAddress, address to, string memory amount, OperationParams memory op) external;

    function burn(address tokenAddress, address from, string memory amount, OperationParams memory op) external;

}
