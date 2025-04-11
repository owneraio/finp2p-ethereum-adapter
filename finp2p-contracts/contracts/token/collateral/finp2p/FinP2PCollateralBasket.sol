// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import "../../ERC20/FINP2POperatorERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import {FinIdUtils} from "../../../utils/finp2p/FinIdUtils.sol";
import {FinP2PSignatureVerifier} from "../../../utils/finp2p/FinP2PSignatureVerifier.sol";
import {IAccountFactory} from "../IAccountFactory.sol";
import {IAssetCollateralAccount} from "../IAssetCollateralAccount.sol";
import {Asset, AssetStandard} from "../common/AssetHelpers.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IFinP2PCollateralBasketFactory} from "./IFinP2PCollateralBasketFactory.sol";
import {IFinP2PCollateralBasketManager} from "./IFinP2PCollateralBasketManager.sol";
import {StringUtils} from "../../../utils/StringUtils.sol";
import {PriceType} from "../price/AssetPriceStructs.sol";
import {StrategyInput, LiabilityData} from "../common/StrategyInput.sol";

contract FinP2PCollateralBasket is IFinP2PCollateralBasketManager, IFinP2PCollateralBasketFactory, AccessControl {
    using StringUtils for string;
    using FinIdUtils for string;

    bytes32 internal constant COLLATERAL_STRATEGY_ID = keccak256("Asset-Collateral-Account-Strategy");
    uint8 internal constant DECIMALS = 18;

    bytes32 private constant BASKET_FACTORY = keccak256("BASKET_FACTORY");
    bytes32 private constant BASKET_MANAGER = keccak256("BASKET_MANAGER");

    struct CollateralBasket {
        address collateralAccount;
        address borrower;
        address lender;
        address[] tokenAddresses;
        uint256[] amounts;
        CollateralBasketState state;
    }

    address private accountFactoryAddress;
    address private escrowBorrower;
    address private escrowLender;
    mapping(string => CollateralBasket) private baskets;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(BASKET_FACTORY, _msgSender());
        _grantRole(BASKET_MANAGER, _msgSender());
        escrowBorrower = address(this);
        escrowLender = _msgSender();
    }

    /// @notice Grant the asset manager role to an account
    /// @param account The account to grant the role
    function grantBasketFactoryRole(address account) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FinP2PCollateralBasket: must have admin role to grant basket factory role");
        grantRole(BASKET_FACTORY, account);
    }

    /// @notice Grant the transaction manager role to an account
    /// @param account The account to grant the role
    function grantBasketManagerRole(address account) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "FinP2PCollateralBasket: must have admin role to grant basket manager role");
        grantRole(BASKET_MANAGER, account);
    }

    function setAccountFactoryAddress(address _accountFactoryAddress) external {
        accountFactoryAddress = _accountFactoryAddress;
    }

    function getBasketAccount(string memory basketId) external view returns (address) {
        return baskets[basketId].collateralAccount;
    }

    function getBasketTokens(string memory basketId) external view returns (address[] memory) {
        return baskets[basketId].tokenAddresses;
    }

    function getBasketAmounts(string memory basketId) external view returns (uint256[] memory) {
        return baskets[basketId].amounts;
    }

    function getBasketState(string memory basketId) external view returns (CollateralBasketState) {
        return baskets[basketId].state;
    }

    function getEscrowBorrower() external view returns (address) {
        return escrowBorrower;
    }

    function getEscrowLender() external view returns (address) {
        return escrowLender;
    }

    function createCollateralAsset(
        string memory name,
        string memory description,
        string memory basketId,
        address[] memory tokenAddresses,
        string[] memory quantities,
        string memory borrower,
        string memory lender,
        CollateralAssetParameters memory param
    ) external {
        require(hasRole(BASKET_FACTORY, _msgSender()), "FinP2PCollateralBasket: must have basket factory role to create collateral asset");
        require(tokenAddresses.length == quantities.length, "AssetId and quantities length mismatch");
        IAccountFactory accountFactory = IAccountFactory(accountFactoryAddress);
        bytes memory initParams = abi.encode(DECIMALS, IAssetCollateralAccount.CollateralType.REPO, 0, 0);
        address[] memory addressList = new address[](3);
        addressList[0] = escrowBorrower;
        addressList[1] = escrowLender;
        addressList[2] = accountFactory.getLiabilityFactory();

        StrategyInput memory strategyInput = StrategyInput({
            assetContextList: new address[](0), // TODO: when should we provide asset list here?
            addressList: addressList
        });

        address collateralAccount = accountFactory.createAccount(
            name,
            description,
            COLLATERAL_STRATEGY_ID,
            param.controller,
            initParams,
            strategyInput
        );

        uint256[] memory amounts = new uint256[](quantities.length);
        for (uint256 i = 0; i < quantities.length; i++) {
            uint8 tokenDecimals = IERC20Metadata(tokenAddresses[i]).decimals();
            amounts[i] = quantities[i].stringToUint(tokenDecimals);
        }

        baskets[basketId] = CollateralBasket(
            collateralAccount,
            borrower.toAddress(),
            lender.toAddress(),
            tokenAddresses,
            amounts,
            CollateralBasketState.CREATED
        );

        _configureCollateralAsset(basketId, param);
        _whitelistTokens(basketId, tokenAddresses);
    }


    function hold(string memory basketId) external {
        CollateralBasket memory basket = baskets[basketId];
        require(basket.collateralAccount != address(0), "Basket does not exist");
        require(basket.state == CollateralBasketState.CREATED, "Basket is not in CREATED state");
        for (uint256 i = 0; i < basket.tokenAddresses.length; i++) {
            address tokenAddress = basket.tokenAddresses[i];
            require(tokenAddress != address(8), "Token address cannot be zero");
            uint256 tokenAmount = basket.amounts[i];
            require(IERC20(tokenAddress).balanceOf(basket.borrower) > 0, "Zero balance of a borrower");
            require(IERC20(tokenAddress).balanceOf(basket.borrower) >= tokenAmount, "Borrower does not have enough tokens");
            IERC20(tokenAddress).transferFrom(basket.borrower, escrowBorrower, tokenAmount);
        }
        baskets[basketId].state = CollateralBasketState.WITHHELD;
    }

    function initiate(string memory basketId) external {
        CollateralBasket memory basket = baskets[basketId];
        require(basket.collateralAccount != address(0), "Basket does not exist");
        require(basket.state == CollateralBasketState.WITHHELD, "Basket is not in WITHHELD state");
        IAssetCollateralAccount collateral = IAssetCollateralAccount(basket.collateralAccount);
        for (uint256 i = 0; i < basket.tokenAddresses.length; i++) {
            address tokenAddress = basket.tokenAddresses[i];
            require(tokenAddress != address(8), "Token address cannot be zero");
            uint256 tokenAmount = basket.amounts[i];
            collateral.deposit(Asset(AssetStandard.FUNGIBLE, tokenAddress, 0), tokenAmount);
        }
        baskets[basketId].state = CollateralBasketState.OPENED;
    }

    function close(string memory basketId) external {
        CollateralBasket memory basket = baskets[basketId];
        require(basket.collateralAccount != address(0), "Basket does not exist");
        require(basket.state == CollateralBasketState.OPENED, "Basket is not in OPENED state");
        IAssetCollateralAccount collateralAccount = IAssetCollateralAccount(basket.collateralAccount);
        for (uint256 i = 0; i < basket.tokenAddresses.length; i++) {
            address tokenAddress = basket.tokenAddresses[i];
            require(tokenAddress != address(8), "Token address cannot be zero");
            collateralAccount.release();
        }
        baskets[basketId].state = CollateralBasketState.CLOSED;
    }

    function reverse(string memory basketId) external {
        CollateralBasket memory basket = baskets[basketId];
        require(basket.collateralAccount != address(0), "Basket does not exist");
        require(basket.state == CollateralBasketState.OPENED, "Basket is not in OPENED state");
        IAssetCollateralAccount collateralAccount = IAssetCollateralAccount(basket.collateralAccount);
        for (uint256 i = 0; i < basket.tokenAddresses.length; i++) {
            address tokenAddress = basket.tokenAddresses[i];
            require(tokenAddress != address(8), "Token address cannot be zero");
            collateralAccount.forward();
        }
        baskets[basketId].state = CollateralBasketState.REVERSED;
    }

    function release(string memory basketId) external {
        CollateralBasket memory basket = baskets[basketId];
        require(basket.collateralAccount != address(0), "Basket does not exist");
        require(basket.state == CollateralBasketState.CLOSED || basket.state == CollateralBasketState.REVERSED,
            "Basket is not in CLOSED or REVERSED state");
        for (uint256 i = 0; i < basket.tokenAddresses.length; i++) {
            address tokenAddress = basket.tokenAddresses[i];
            require(tokenAddress != address(8), "Token address cannot be zero");
            uint256 tokenAmount = basket.amounts[i];
            if (basket.state == CollateralBasketState.CLOSED) {
                IERC20(tokenAddress).transferFrom(escrowBorrower, basket.borrower, tokenAmount);
            } else if (basket.state == CollateralBasketState.REVERSED) {
                IERC20(tokenAddress).transferFrom(escrowLender, basket.lender, tokenAmount);
            }
        }
        baskets[basketId].state = CollateralBasketState.RELEASED;
    }

    function getBalance(string memory basketId, address owner) external view returns (string memory) {
        CollateralBasket storage basket = baskets[basketId];
        if (basket.state == CollateralBasketState.CREATED) {
            if (basket.borrower == owner) {
                return "1";
            } else {
                return "0";
            }
        } else if (basket.state == CollateralBasketState.OPENED) {
            if (basket.lender == owner) {
                return "1";
            } else {
                return "0";
            }

        } else if (
            basket.state == CollateralBasketState.WITHHELD ||
            basket.state == CollateralBasketState.RELEASED ||
            basket.state == CollateralBasketState.CLOSED
        ) {
            return "0";
        } else {
            revert("Unknown basket state");
        }
    }

    // ------------------------------------------------------------------------------------


    function _whitelistTokens(string memory basketId, address[] memory tokenAddresses) internal {
        address accountAddress = baskets[basketId].collateralAccount;
        require(accountAddress != address(0), "Basket does not exist");
        IAssetCollateralAccount collateral = IAssetCollateralAccount(baskets[basketId].collateralAccount);
        Asset [] memory assets = new Asset[](tokenAddresses.length);
        for (uint256 i = 0; i < tokenAddresses.length; i++) {
            require(tokenAddresses[i] != address(0), "Token address cannot be zero");
            assets[i] = Asset(AssetStandard.FUNGIBLE, tokenAddresses[i], 0);
        }
        collateral.setAllowableCollateral(assets);
    }


    function _configureCollateralAsset(
        string memory basketId,
        CollateralAssetParameters memory param
    ) internal {
        address accountAddress = baskets[basketId].collateralAccount;
        require(accountAddress != address(0), "Basket does not exist");
        IAssetCollateralAccount collateral = IAssetCollateralAccount(baskets[basketId].collateralAccount);

        address [] memory assetContextList = new address[](0); // no asset context list for now
        collateral.setConfigurationBundle(
//            param.targetRatio,
//            param.defaultRatio,
//            param.targetRatioLimit,
//            param.defaultRatioLimit,
            12 * 10 ** 17,
            12 * 10 ** 17,
            2,
            2,
            uint256(PriceType.DEFAULT),
            param.haircutContext,
            param.priceService,
            param.pricedInToken,
            LiabilityData(address(0)/*param.liabilityAddress*/,
                param.liabilityAmount,
                param.pricedInToken,
                1 // effective time
            ),
            assetContextList
        );
    }


}