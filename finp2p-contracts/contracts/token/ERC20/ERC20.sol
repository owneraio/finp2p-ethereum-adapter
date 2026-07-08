// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {ERC20 as OZERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @dev Stock ERC20 built entirely on top of OpenZeppelin ({ERC20} + {ERC20Burnable} +
 * {AccessControl}). Mirrors the public surface of `ERC20WithOperator` (same selectors
 * for name/symbol/decimals/transfer/transferFrom/approve/allowance/balanceOf/
 * totalSupply/mint/burn/burnFrom/grantMinterTo/grantOperatorTo) so callers can point
 * at either contract, but this variant has no operator-role bypasses — `transferFrom`
 * and `burnFrom` both require a standard ERC20 allowance regardless of caller role.
 */
contract ERC20 is OZERC20, ERC20Burnable, AccessControl {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address operator) OZERC20(name_, symbol_) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(MINTER_ROLE, operator);
        _grantRole(OPERATOR_ROLE, operator);
        _decimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) public {
        require(hasRole(MINTER_ROLE, _msgSender()), "ERC20: must have minter role to mint");
        _mint(to, amount);
    }

    function grantMinterTo(address account) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "ERC20: must have admin role to grant minter");
        grantRole(MINTER_ROLE, account);
    }

    function grantOperatorTo(address account) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "ERC20: must have admin role to grant operator");
        grantRole(OPERATOR_ROLE, account);
    }
}
