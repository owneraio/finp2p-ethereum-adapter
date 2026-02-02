// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "./ERC20WithOperator.sol";

contract SimplifiedERC20 is ERC20WithOperator {
    constructor(string memory name, string memory symbol, uint8 decimals) ERC20WithOperator(name, symbol, decimals, _msgSender()) {}
}
