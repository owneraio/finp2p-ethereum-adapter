// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../../utils/finp2p/FinP2PSignatureVerifier.sol";

interface IFinP2PCollateralBasketFactory {

    function createCollateralAsset(
        string memory name,
        string memory description,
        string memory basketId,
        address[] memory tokenAddresses,
        string[] memory quantities,
        string memory sourceFinId,
        string memory destinationFinId
    ) external;

}