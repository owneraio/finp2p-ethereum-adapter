// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/cryptography/EIP712.sol)

pragma solidity ^0.8.20;

import "./EarmarkProvider.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract EarmarkEscrow is EarmarkProvider {

    address private owner;

    struct Lock {
        address tokenAddress;
        uint256 amount;
        bool earmarkProofProvided;
    }

    mapping(uint256 => Lock) private locks;

    constructor() EarmarkProvider() {
        // Set the contract deployer as the owner
        owner = msg.sender;
    }

    function getOwner() external view returns (address) {
        return owner;
    }

    function deposit(uint256 lockId, address tokenAddress, uint256 amount, Earmark memory _earmark) external {
        storeEarmark(lockId, _earmark);
        IERC20 token = IERC20(tokenAddress);
        token.transferFrom(msg.sender, address(this), amount);
        storeLock(lockId, tokenAddress, amount);
    }

    // should be checked by the orchestrator to verify if the tokens are deposited
    function isDeposited(uint256 lockId) external view returns (bool) {
        Lock memory lock = locks[lockId];
        require(lock.tokenAddress != address(0), "No lock found for this operationId");

        IERC20 token = IERC20(lock.tokenAddress);
        return token.balanceOf(address(this)) >= lock.amount;
    }

    function release(uint256 lockId, address to) external {
        Lock memory lock = locks[lockId];
        require(lock.tokenAddress != address(0), "No lock found for this operationId");
        require(lock.earmarkProofProvided, "Earmark proof not provided");

        IERC20 token = IERC20(lock.tokenAddress);
        token.transfer(to, lock.amount);
    }

    function rollback(uint256 amount) external {
        // only while rollback conditions are met
        // TODO: unlock after certain time or other conditions

//        IERC20 token = IERC20(tokenAddress);
//        token.transferFrom(address(this), owner, amount);
    }


    function storeLock(uint256 operationId, address tokenAddress, uint256 amount) internal {
        locks[operationId] = Lock(tokenAddress, amount, false);
    }

    function provideEarmarkProof(uint256 lockId, ReceiptProof memory proof) external {
        validateEarmarkProof(lockId, proof);
        locks[lockId].earmarkProofProvided = true;
    }
}
