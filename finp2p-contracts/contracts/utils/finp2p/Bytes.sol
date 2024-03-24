// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @dev Library containing functions for manipulating FinP2P FinID and other utility methods.
 */
library Bytes {

    function finIdToAddress(string memory finId) internal pure returns (address) {
        return compressedPublicKeyToAddress(fromHex(finId));
    }

    function fromHexChar(uint8 c) public pure returns (uint8) {
        if (bytes1(c) >= bytes1('0') && bytes1(c) <= bytes1('9')) {
            return c - uint8(bytes1('0'));
        }
        if (bytes1(c) >= bytes1('a') && bytes1(c) <= bytes1('f')) {
            return 10 + c - uint8(bytes1('a'));
        }
        if (bytes1(c) >= bytes1('A') && bytes1(c) <= bytes1('F')) {
            return 10 + c - uint8(bytes1('A'));
        }
        return 0;
    }

    // Convert an hexadecimal string to raw bytes
    function fromHex(string memory s) public pure returns (bytes memory) {
        bytes memory ss = bytes(s);
        require(ss.length % 2 == 0);

        bytes memory r = new bytes(ss.length / 2);
        for (uint i = 0; i < ss.length / 2; ++i) {
            r[i] = bytes1(fromHexChar(uint8(ss[2 * i])) * 16 +
                fromHexChar(uint8(ss[2 * i + 1])));
        }
        return r;
    }

    uint256 constant AA = 0;
    uint256 constant BB = 7;
    uint256 constant PP = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;

    function compressedPublicKeyToAddress(bytes memory _pubKey) public pure returns (address) {
        uint8 prefix = uint8(_pubKey[0]);
        uint x;
        assembly {
            x := mload(add(_pubKey, add(0x20, 0x01)))
        }
        uint256 y = deriveY(prefix, x, AA, BB, PP);
        bytes32 hash = keccak256(abi.encodePacked(x, y));
        return address(uint160(uint256(hash)));
    }

    function deriveY(uint8 _prefix, uint256 _x, uint256 _aa, uint256 _bb, uint256 _pp) internal pure returns (uint256) {
        require(_prefix == 0x02 || _prefix == 0x03, "Invalid compressed EC point prefix");
        uint256 y2 = addmod(mulmod(_x, mulmod(_x, _x, _pp), _pp), addmod(mulmod(_x, _aa, _pp), _bb, _pp), _pp);
        y2 = expmod(y2, (_pp + 1) / 4, _pp);
        return (y2 + _prefix) % 2 == 0 ? y2 : _pp - y2;
    }

    uint256 constant private U255_MAX_PLUS_1 = 57896044618658097711785492504343953926634992332820282019728792003956564819968;

    function expmod(uint256 _base, uint256 _exp, uint256 _pp) internal pure returns (uint256) {
        require(_pp != 0, "Modulus is zero");
        if (_base == 0) return 0;
        if (_exp == 0) return 1;

        uint256 r = 1;
        uint256 bit = U255_MAX_PLUS_1;
        assembly {
            for {} gt(bit, 0) {}{
                r := mulmod(mulmod(r, r, _pp), exp(_base, iszero(iszero(and(_exp, bit)))), _pp)
                r := mulmod(mulmod(r, r, _pp), exp(_base, iszero(iszero(and(_exp, div(bit, 2))))), _pp)
                r := mulmod(mulmod(r, r, _pp), exp(_base, iszero(iszero(and(_exp, div(bit, 4))))), _pp)
                r := mulmod(mulmod(r, r, _pp), exp(_base, iszero(iszero(and(_exp, div(bit, 8))))), _pp)
                bit := div(bit, 16)
            }
        }
        return r;
    }

}