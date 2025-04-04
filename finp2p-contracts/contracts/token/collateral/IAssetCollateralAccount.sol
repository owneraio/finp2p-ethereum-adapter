// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

interface IAssetCollateralAccount {

    enum AssetStandard {
        NETWORK, //ETHER,
        FUNGIBLE, //ERC20,
        NON_FUNGIBLE, //ERC721,
        PART_FUNGIBLE, //ERC1155,
        ITEM, //Composer non-fungible item
        OTHER
    }

    struct Asset {
        AssetStandard standard;
        address addr;
        uint256 tokenId;
    }

    struct LiabilityData {
        address liabilityAddress;
        uint256 amount;
        address pricedInToken;
        uint256 effectiveTime;
    }

    function setAllowableCollateral(
        address[] memory assetList
    ) external;

    function setPricedItemConfiguration(
        address priceService,
        address pricedInToken,
        uint256 priceType
    ) external;

    function setConfigurationBundle(
        uint256 targetRatio,
        uint256 defaultRatio,
        uint256 targetRatioLimit,
        uint256 defaultRatioLimit,
        uint256 priceType,
        address haircutContext,
        address priceService,
        address pricedInToken,
        LiabilityData memory liabilityData,
        address[] memory assetContextList
    ) external;

    function processInterval(uint256 triggerId, uint256 timestamp) external;

    function deposit(Asset calldata _asset, uint256 _amount) external;

    event EscrowReleased(address _source);
    event EscrowForwarded(address _destination);

    /// @notice [permission] controller or Role:EscrowAgent
    function release() external; //send assets back to source (borrower) when the obligation is met

    function forward() external; //send assets to destination (lender – usually on default)

    function partialForward(Asset[] calldata _assets, uint256[] calldata _amounts) external;

    function partialRelease(Asset[] calldata _assets, uint256[] calldata _amounts) external;
}