// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

interface Burnable {
    function burn(uint256 value) external;
    function burnFrom(address account, uint256 value) external;
}
