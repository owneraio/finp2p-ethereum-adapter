// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Strings.sol";

library DecimalStringUtils {
    using Strings for uint256;

    /// @notice Converts a decimal string (e.g., "12.34") to an integer with `decimals` precision.
    /// @param str The decimal string.
    /// @param decimals The number of decimal places to consider.
    /// @return The integer representation with `decimals` precision.
    function stringToUint(string memory str, uint8 decimals) internal pure returns (uint256) {
        bytes memory b = bytes(str);
        uint256 result = 0;
        bool hasDecimals = false;
        uint8 decimalPlaces = 0;

        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == ".") {
                require(!hasDecimals, "Invalid format: Multiple decimal points");
                hasDecimals = true;
                continue;
            }

            require(b[i] >= "0" && b[i] <= "9", "Invalid character in number");
            result = result * 10 + (uint256(uint8(b[i])) - 48);

            if (hasDecimals) {
                decimalPlaces++;
            }
        }

        if (decimalPlaces > decimals) {
            result /= (10 ** (decimalPlaces - decimals)); // Reduce precision
        } else if (decimalPlaces < decimals) {
            result *= (10 ** (decimals - decimalPlaces)); // Increase precision
        }

        return result;
    }

    /// @notice Converts an integer back to a decimal string representation.
    /// @param value The integer representation.
    /// @param decimals The number of decimal places.
    /// @return The string representation.
//    function uintToString(uint256 value, uint8 decimals) internal pure returns (string memory) {
//        uint256 factor = 10 ** decimals;
//        uint256 integerPart = value / factor;
//        uint256 decimalPart = value % factor;
//
//        if (decimalPart == 0) {
//            return integerPart.toString();
//        }
//        return string(abi.encodePacked(integerPart.toString(), ".", decimalPart.toString()));
//    }

    function uintToString(uint256 value, uint8 decimals) internal pure returns (string memory) {
        if (decimals == 0) {
            return value.toString(); // No decimals, return integer as string
        }

        uint256 factor = 10 ** decimals;
        uint256 integerPart = value / factor;
        uint256 decimalPart = value % factor;

        // Ensure decimalPart always has the correct number of leading zeros
        string memory decimalStr = decimalPart.toString();
        uint8 missingZeros = decimals - uint8(bytes(decimalStr).length);

        // Prefix missing zeros if needed
        if (missingZeros > 0) {
            string memory zeroPadding = new string(missingZeros);
            bytes memory zeroBytes = bytes(zeroPadding);
            for (uint8 i = 0; i < missingZeros; i++) {
                zeroBytes[i] = "0";
            }
            return string(abi.encodePacked(integerPart.toString(), ".", string(zeroBytes), decimalStr));
        }

        return string(abi.encodePacked(integerPart.toString(), ".", decimalStr));
    }
}