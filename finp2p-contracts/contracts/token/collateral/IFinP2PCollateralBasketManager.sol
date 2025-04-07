// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../../utils/finp2p/FinP2PSignatureVerifier.sol";

interface IFinP2PCollateralBasketManager {

    function hasActiveBasket(string memory basketId, address ownerAddress) external view returns (bool);

    function process(string memory basketId, string memory quantity, FinP2PSignatureVerifier.Phase phase) external;
}