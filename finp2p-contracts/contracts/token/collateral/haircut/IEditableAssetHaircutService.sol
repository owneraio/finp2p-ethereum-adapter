// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

import {Asset} from "../common/AssetHelpers.sol";

interface IEditableAssetHaircutService {

    function setAssetHaircut(Asset memory asset, uint256 haircut) external;

}
