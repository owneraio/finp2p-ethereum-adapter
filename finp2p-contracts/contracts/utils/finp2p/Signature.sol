// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @dev Library for FinP2P protocol signature verification.
 */
library Signature {

    bytes private constant ISSUE_ACTION = "issue";
    bytes private constant REDEEM_ACTION = "redeem";
    bytes private constant TRANSFER_ACTION = "transfer";
    bytes private constant FINP2P_ASSET_TYPE = "finp2p";
    bytes private constant FIAT_ASSET_TYPE = "fiat";
    bytes private constant DEFAULT_ACCOUNT_TYPE = "finId";

     enum  AssetType {
        FinP2P,
        Fiat
    }

    function isIssueHashValid(
        bytes32 nonce,
        string memory assetId,
        string memory accountId,
        uint256 quantity,
        bytes32 settlementHash,
        bytes32 hash
    ) internal pure returns (bool) {
        bytes32 assetHash = keccak256(abi.encodePacked(
            nonce,
            ISSUE_ACTION,
            FINP2P_ASSET_TYPE,
            assetId,
            DEFAULT_ACCOUNT_TYPE,
            accountId,
            Strings.toString(quantity)
        ));
        return keccak256(abi.encodePacked(assetHash, settlementHash)) == hash;
    }


    function isRedeemHashValid(
        bytes32 nonce,
        string memory assetId,
        string memory accountId,
        uint256 quantity,
        bytes32 settlementHash,
        bytes32 hash
    ) internal pure returns (bool) {
        bytes32 assetHash = keccak256(abi.encodePacked(
                nonce,
                REDEEM_ACTION,
                FINP2P_ASSET_TYPE,
                assetId,
                DEFAULT_ACCOUNT_TYPE,
                accountId,
                Strings.toString(quantity)
            ));
        return keccak256(abi.encodePacked(assetHash, settlementHash)) == hash;
    }

    function isTransferHashValid(
        bytes32 nonce,
        string memory assetId,
        string memory sourceFinId,
        string memory destFinId,
        uint256 quantity,
        bytes32 settlementHash,
        bytes32 transferHash
    ) internal pure returns (bool) {
        bytes32 assetHash = keccak256(abi.encodePacked(
                nonce,
                TRANSFER_ACTION,
                FINP2P_ASSET_TYPE,
                assetId,
                DEFAULT_ACCOUNT_TYPE,
                sourceFinId,
                DEFAULT_ACCOUNT_TYPE,
                destFinId,
                Strings.toString(quantity)
            ));
        if (settlementHash.length > 0) {
            return keccak256(abi.encodePacked(assetHash, settlementHash)) == transferHash;
        } else {
            return keccak256(abi.encodePacked(assetHash)) == transferHash;
        }
    }

function assetTypeName(AssetType assetType) internal pure returns (bytes memory){
unchecked{
    if (assetType == AssetType.FinP2P) {
        return FINP2P_ASSET_TYPE;
    } else {
        return FIAT_ASSET_TYPE;
    }
}
}

    function isHoldHashValid(
        string memory assetId,
        string memory sourceAccountId,
        string memory destinationAccountId,
        uint256 quantity,
        uint256 expiry,
        bytes32 assetHash,
        AssetType assetType,
        bytes32 hash
    ) internal pure returns (bool) {
        bytes memory assetTypeBytes = assetTypeName(assetType);
        bytes32 settlementHash = keccak256(abi.encodePacked(
                assetTypeBytes,
                assetId,
                DEFAULT_ACCOUNT_TYPE,
                sourceAccountId,
                DEFAULT_ACCOUNT_TYPE,
                destinationAccountId,
                Strings.toString(quantity),
                Strings.toString(expiry)
            ));
        return keccak256(abi.encodePacked(assetHash, settlementHash)) == hash;
    }

    function verify(
        address _signer,
        bytes32 _hash,
        bytes memory _signature
    ) internal pure returns (bool) {
        bytes32 r;
        bytes32 s;
        assembly {
            r := mload(add(_signature, 0x20))
            s := mload(add(_signature, 0x40))
        }
        for (uint8 v = 27; v <= 28; v++) {
            (address recovered, ECDSA.RecoverError error, bytes32 sRec) = ECDSA.tryRecover(_hash, v, r, s);
            if (error == ECDSA.RecoverError.NoError && recovered == _signer && sRec == bytes32(0)) {
                return true;
            }
        }
        return false;
    }

}