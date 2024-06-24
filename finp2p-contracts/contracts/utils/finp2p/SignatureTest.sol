// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "../../utils/finp2p/Signature.sol";
import "../../utils/finp2p/Bytes.sol";

/**
 * @dev Test contract for FinP2P protocol signature verification.
 */
contract SignatureTest {

    function verifyHoldSignature(
        string memory _assetId,
        string memory _sourceAccountId,
        string memory _destinationAccountId,
        address _owner,
        uint256 _quantity,
        uint256 _expiry,
        bytes32 _assetHash,
        bytes32 _hash,
        Signature.AssetType _assetType,
        bytes memory _signature
    ) public pure returns (bool) {
        require(Signature.isHoldHashValid(
                _assetId,
                _sourceAccountId,
                _destinationAccountId,
                _quantity,
                _expiry,
                _assetHash,
                _assetType,
                _hash
            ), "Hash is not valid for hold");

        require(Signature.verify(
                _owner,
                _hash,
                _signature
            ),
            "Signature is not verified");

        return true;
    }

    function verifyTransferSignature(
        bytes32 _nonce,
        string memory _assetId,
        string memory _sourceFinId,
        address _source,
        string memory _destinationFinId,
        uint256 _quantity,
        bytes32 _settlementHash,
        bytes32 _hash,
        bytes memory _signature
    ) public pure returns (bool) {
        require(Signature.isTransferHashValid(
                _nonce,
                _assetId,
                _sourceFinId,
                _destinationFinId,
                _quantity,
                _settlementHash,
                _hash
            ), "Hash is not valid for transfer");

        require(Signature.verify(
                _source,
                _hash,
                _signature
            ),
            "Signature is not verified");
        return true;
    }

    function verifyRedeemSignature(
        bytes32 _nonce,
        string memory _assetId,
        string memory _issuerFinId,
        address _issuer,
        uint256 _quantity,
        bytes32 _settlementHash,
        bytes32 _hash,
        bytes memory _signature
    ) public pure returns (bool) {
        require(Signature.isRedeemHashValid(
                _nonce,
                _assetId,
                _issuerFinId,
                _quantity,
                _settlementHash,
                _hash
            ), "Hash is not valid for redeem");

        require(Signature.verify(
                _issuer,
                _hash,
                _signature
            ),
            "Signature is not verified");
        return true;
    }

    function finIdToAddress(string memory finId) public pure returns (address) {
        return Bytes.finIdToAddress(finId);
    }
}