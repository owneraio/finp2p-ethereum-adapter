// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/**
 * @dev Library for FinP2P protocol signature verification.
 */
library Signature {

    /**
     * @dev Verify signature.
     * FinP2P signature analogue to Openzepppelin's `SignatureChecker.isValidSignatureNow`
     */
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

    function isEmptyBytes32(bytes32 value) public pure returns (bool) {
        return value == bytes32(0);
    }


}