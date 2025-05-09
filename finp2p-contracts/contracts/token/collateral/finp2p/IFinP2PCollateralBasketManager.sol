// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../../../utils/finp2p/FinP2PSignatureVerifier.sol";

interface IFinP2PCollateralBasketManager {

    function hold(string memory basketId) external;

    // open collateral
    function initiate(string memory basketId) external;

    function close(string memory basketId) external;

    // collateral default
    function reverse(string memory basketId) external;

    function release(string memory basketId) external;

    function getBalance(string memory basketId, address owner) external view returns (string memory);


}