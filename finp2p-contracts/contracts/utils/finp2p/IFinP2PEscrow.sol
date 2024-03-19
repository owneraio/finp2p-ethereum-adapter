// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (token/ERC20/utils/TokenTimelock.sol)

pragma solidity ^0.8.0;

import "./IFinP2PCommon.sol";

/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface IFinP2PEscrow is IFinP2PCommon {

    struct LockInfo {
        string assetId;
        uint256 amount;
        uint256 expiry;
    }

    event Hold(string assetId, string finId, uint256 quantity, bytes16 operationId);
    event Release(string assetId, string sourceFinId, string destinationFinId, uint256 quantity, bytes16 operationId);
    event Rollback(string assetId, string finId, uint256 quantity, bytes16 operationId);

    function hold(bytes16 operationId, string memory assetId, string memory sourceFinId, string memory destinationFinId,
        uint256 quantity, uint256 expiry, bytes32 assetHash, bytes32 hash, bytes memory signature) external;

    function getLockInfo(bytes16 operationId) external view returns (LockInfo memory);

    function release(bytes16 operationId, string memory destinationFinId) external;

    function rollback(bytes16 operationId) external;

}