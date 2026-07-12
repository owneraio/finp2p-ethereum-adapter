// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {FinIdUtils} from "../../utils/finp2p/FinIdUtils.sol";

/**
 * @dev Per-organization registry of ledger-proof signers. A receipt proof for
 * an instruction executed on another ledger is only accepted when signed by an
 * address registered for the organization that executed it.
 */
abstract contract ProofSignerRegistry is AccessControl {
    using FinIdUtils for string;

    bytes32 internal constant ASSET_MANAGER = keccak256("ASSET_MANAGER");

    mapping(bytes32 => mapping(address => bool)) private orgProofSigners;
    mapping(bytes32 => uint256) private orgProofSignerCount;

    event ProofSignerAdded(string orgId, address signer);
    event ProofSignerRemoved(string orgId, address signer);

    function addProofSigner(string calldata orgId, address signer) external onlyRole(ASSET_MANAGER) {
        _addProofSigner(orgId, signer);
    }

    /// @notice Register a proof signer by its finId (compressed secp256k1 public key).
    function addProofSignerFinId(string calldata orgId, string calldata finId) external onlyRole(ASSET_MANAGER) {
        _addProofSigner(orgId, finId.toAddress());
    }

    function removeProofSigner(string calldata orgId, address signer) external onlyRole(ASSET_MANAGER) {
        bytes32 orgKey = _orgKey(orgId);
        require(orgProofSigners[orgKey][signer], "ProofSignerRegistry: signer not registered");
        orgProofSigners[orgKey][signer] = false;
        orgProofSignerCount[orgKey] -= 1;
        emit ProofSignerRemoved(orgId, signer);
    }

    function isProofSigner(string memory orgId, address signer) public view returns (bool) {
        return orgProofSigners[_orgKey(orgId)][signer];
    }

    function hasProofSigners(string memory orgId) public view returns (bool) {
        return orgProofSignerCount[_orgKey(orgId)] > 0;
    }

    function _addProofSigner(string calldata orgId, address signer) private {
        require(signer != address(0), "ProofSignerRegistry: signer cannot be zero");
        bytes32 orgKey = _orgKey(orgId);
        require(!orgProofSigners[orgKey][signer], "ProofSignerRegistry: signer already registered");
        orgProofSigners[orgKey][signer] = true;
        orgProofSignerCount[orgKey] += 1;
        emit ProofSignerAdded(orgId, signer);
    }

    function _orgKey(string memory orgId) private pure returns (bytes32) {
        return keccak256(bytes(orgId));
    }
}
