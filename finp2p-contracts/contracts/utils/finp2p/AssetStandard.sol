// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

interface AssetStandard {

    function balanceOf(address tokenAddress, address account) external view returns (string memory);

    function transferFrom(address tokenAddress, address from, address to, string memory value) external returns (bool);

    function mint(address tokenAddress, address to, string memory amount) external;

    function burn(address tokenAddress, address from, string memory amount) external;

}
