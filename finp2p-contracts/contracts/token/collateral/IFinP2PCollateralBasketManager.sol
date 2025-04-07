// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../../utils/finp2p/FinP2PSignatureVerifier.sol";

interface IFinP2PCollateralBasketManager {

    function getBalance(string memory basketId, address owner) external view returns (string memory);

    function process(string memory basketId, string memory quantity, FinP2PSignatureVerifier.Phase phase) external;
}