// Copyright 2024 All Rights Reserved
// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

interface IAccountFactory {

    struct StrategyInput {
        address[] assetContextList;
        address[] addressList;
    }

    // Functions
    function addAccountStrategy(address accountStrategy) external;

    function createAccount(
        string calldata name,
        string calldata description,
        bytes32 accountStandard,
        address controller,
        bytes calldata data,
        StrategyInput calldata strategyInput
    ) external returns (address);

    function getAccountIssuer(address account) external view returns (address);

    function getAccountStandard(address accountAddress) external view returns (bytes32);

    function getIssuedAccounts(bytes32 standard, uint256 start, uint256 length) external view returns (address[] memory);

    function getIssuedAccountsTotal(bytes32 standard) external view returns (uint256);

    function getLiabilityFactory() external view returns (address);

    function getSupportedStandardsLength() external view returns (uint256);

    function initialize(
        string calldata name,
        string calldata description,
        address updatesRepository,
        address dataContextFactoryAddress,
        address propertyRegistry,
        address liabilityFactory,
        address controller
    ) external;

    function isSupported(bytes32 standard) external view returns (bool);

    function removeAccountStrategy(bytes32 standard) external;

    function updateAccountStrategy(address accountStrategyNew) external;

    function controller() external view returns (address);

    // Events
    event AccountCreated(
        address account,
        uint256 accountId,
        address controller,
        string name,
        string desc,
        bytes32 standard
    );

    event DataContextCreated(
        address indexed token,
        uint256 indexed contextId,
        address indexed creator,
        string contextType
    );

    event StrategyApplied(bytes32 standard, address strategy);
    event StrategyRemoved(bytes32 standard, address strategy);

    // Custom errors
    error AccountFactoryAccountNotUpdatedToLatestVersion();
    error AccountFactoryEmptyOwnerAddress();
    error AccountFactoryEmptySetupAddress();
    error AccountFactoryEmptyStrategyAddress();
    error AccountFactoryEmptySymbolRegsitroyAddress();
    error AccountFactoryEmptyUpdatesRepositoryAddress();
    error AccountFactoryEtherDepositNotAllowed();
    error AccountFactoryMethodNotFound();
    error AccountFactoryNoOldStrategyError();
    error AccountFactoryNoRoleError();
    error AccountFactoryStrategyAlreadyApplied();
    error AccountFactoryStrategyError();
    error AccountFactoryZeroAddress();
    error AccountStrategyNoUpdatesRepositorySupport();

}