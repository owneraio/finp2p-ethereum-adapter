// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../../utils/finp2p/FinP2PSignatureVerifier.sol";

interface IFinP2PCollateralBasketFactory {

    function createCollateralBasket(
        string memory name,
        string memory description,
        string memory basketId,
        address[] memory tokenAddresses,
        uint256[] memory amounts,
        address source,
        address destination
    ) external;

}