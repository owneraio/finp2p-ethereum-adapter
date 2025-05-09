// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {IContext} from "../common/IContext.sol";
import {IAssetPriceService} from "./IAssetPriceService.sol";
import {IPriceContext} from "./IPriceContext.sol";

interface IAssetPriceContext is IContext, IPriceContext, IAssetPriceService {}
