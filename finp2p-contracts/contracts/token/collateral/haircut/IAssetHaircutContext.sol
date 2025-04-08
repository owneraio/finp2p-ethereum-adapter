// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;


import { IContext } from "../common/IContext.sol";
import { IEditableAssetHaircutService } from "./IEditableAssetHaircutService.sol";
import { IEmbeddableItem } from "../common/IEmbeddableItem.sol";

interface IAssetHaircutContext is IContext, IEditableAssetHaircutService, IEmbeddableItem {

}
