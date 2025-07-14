// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../StringUtils.sol";
import "../finp2p/AssetStandard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Burnable} from "./Burnable.sol";
import {Mintable} from "./Mintable.sol";

abstract contract ERC20Standard is AssetStandard {
    using StringUtils for string;
    using StringUtils for uint256;

    function balanceOf(address tokenAddress, address account) external view returns (string memory) {
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        IERC20 token = IERC20(tokenAddress);
        uint256 tokenBalance = token.balanceOf(account);
        return tokenBalance.uintToString(tokenDecimals);
    }

    function transferFrom(address tokenAddress, address from, address to, string memory quantity) external returns (bool) {
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        uint256 balance = IERC20(tokenAddress).balanceOf(from);
        require(balance >= tokenAmount, "Not sufficient balance to transfer");
        IERC20 token = IERC20(tokenAddress);
        return token.transferFrom(from, to, tokenAmount);
    }

    function mint(address tokenAddress, address to, string memory quantity) external {
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        Mintable(tokenAddress).mint(to, tokenAmount);
    }

    function burn(address tokenAddress, address from, string memory quantity) external {
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        uint256 tokenAmount = quantity.stringToUint(tokenDecimals);
        uint256 balance = IERC20(tokenAddress).balanceOf(from);
        require(balance >= tokenAmount, "Not sufficient balance to burn");
        Burnable(tokenAddress).burn(from, tokenAmount);
    }

}
