// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

/**
 * @title ITokenStandard
 * @notice On-chain interface for token standard implementations registered
 *         in the FinP2P asset registry.
 *
 * Each token standard (ERC20, Collateral, etc.) implements this interface.
 * The FinP2P contract dispatches operations to the registered implementation
 * based on the asset's token standard key.
 *
 * This is the on-chain counterpart of the off-chain TokenStandard TypeScript
 * interface in this same package.
 */
interface ITokenStandard {

    /**
     * @notice Query the balance of an account for a given token.
     * @param tokenAddress The token contract address.
     * @param account The account to query.
     * @return The balance as a string (decimal representation).
     */
    function balanceOf(
        address tokenAddress,
        address account
    ) external view returns (string memory);

    /**
     * @notice Mint tokens to an address.
     * @param tokenAddress The token contract address.
     * @param to The recipient address.
     * @param amount The amount to mint (decimal string).
     */
    function mint(
        address tokenAddress,
        address to,
        string memory amount
    ) external;

    /**
     * @notice Transfer tokens between addresses.
     * @param tokenAddress The token contract address.
     * @param from The source address.
     * @param to The destination address.
     * @param amount The amount to transfer (decimal string).
     */
    function transferFrom(
        address tokenAddress,
        address from,
        address to,
        string memory amount
    ) external returns (bool);

    /**
     * @notice Burn tokens from an address.
     * @param tokenAddress The token contract address.
     * @param from The address to burn from.
     * @param amount The amount to burn (decimal string).
     */
    function burn(
        address tokenAddress,
        address from,
        string memory amount
    ) external;
}
