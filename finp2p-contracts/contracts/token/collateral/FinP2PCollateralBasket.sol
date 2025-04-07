// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../../utils/StringUtils.sol";
import "./IAccountFactory.sol";
import {FinP2PSignatureVerifier} from "../../utils/finp2p/FinP2PSignatureVerifier.sol";
import {IAccountFactory} from "./IAccountFactory.sol";
import {IAssetCollateralAccount} from "./IAssetCollateralAccount.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFinP2PCollateralBasketManager} from "./IFinP2PCollateralBasketManager.sol";
import {IFinP2PCollateralBasketFactory} from "./IFinP2PCollateralBasketFactory.sol";

contract FinP2PCollateralBasket is IFinP2PCollateralBasketManager, IFinP2PCollateralBasketFactory {
    using StringUtils for string;

    bytes32 internal constant COLLATERAL_STRATEGY_ID = keccak256("Asset-Collateral-Account-Strategy");
    uint8 internal constant DECIMALS = 18;

    struct CollateralBasket {
        address collateralAccount;
        address source;
        address destination;
        address[] tokenAddresses;
        uint256[] amounts;
    }

    address private accountFactoryAddress;
    mapping(string => CollateralBasket) private baskets;

    function setAccountFactoryAddress(address _accountFactoryAddress) external {
        accountFactoryAddress = _accountFactoryAddress;
    }

    function createCollateralBasket(
        string memory name,
        string memory description,
        string memory basketId,
        address[] memory tokenAddresses,
        uint256[] memory amounts,
        address source,
        address destination
    ) external {
        require(tokenAddresses.length == amounts.length, "AssetId and amounts length mismatch");

        IAccountFactory accountFactory = IAccountFactory(accountFactoryAddress);
        bytes memory initParams = abi.encode(DECIMALS, IAssetCollateralAccount.CollateralType.REPO, 0, 0);

        address[] memory addressList = new address[](3);
        addressList[0] = source;
        addressList[1] = destination;
        addressList[2] = accountFactory.getLiabilityFactory();
        address controller = accountFactory.controller();

        IAccountFactory.StrategyInput memory strategyInput = IAccountFactory.StrategyInput({
            assetContextList: new address[](0), // TODO: when should we provide asset list here?
            addressList: addressList
        });

        address collateralAccount = accountFactory.createAccount(
            name,
            description,
            COLLATERAL_STRATEGY_ID,
            controller,
            initParams,
            strategyInput
        );
        baskets[basketId] = CollateralBasket(
            collateralAccount,
            source,
            destination,
            tokenAddresses,
            amounts
        );
    }

    function hasActiveBasket(string memory basketId, address ownerAddress) external view returns (bool) {
        CollateralBasket storage basket = baskets[basketId];
        return basket.source == ownerAddress;
    }

    function process(string memory basketId, string memory quantity, FinP2PSignatureVerifier.Phase phase) external {
        require(baskets[basketId].collateralAccount != address(0), "Basket does not exist");
        require(quantity.stringToUint(18) == 10 ** 18, "Quantity must be 1");

        IAssetCollateralAccount collateralAccount = IAssetCollateralAccount(baskets[basketId].collateralAccount);
        for (uint256 i = 0; i < baskets[basketId].tokenAddresses.length; i++) {
            address tokenAddress = baskets[basketId].tokenAddresses[i];
            if (phase == FinP2PSignatureVerifier.Phase.INITIATE) {
                uint256 tokenAmount = baskets[basketId].amounts[i];
                collateralAccount.deposit(
                    IAssetCollateralAccount.Asset(IAssetCollateralAccount.AssetStandard.FUNGIBLE, tokenAddress, 0),
                    tokenAmount
                );
            } else if (phase == FinP2PSignatureVerifier.Phase.CLOSE) {
                collateralAccount.release();

            } else if (phase == FinP2PSignatureVerifier.Phase.NONE) {
                // TODO: do nothing, maybe send a fake event
            }
        }
    }
}