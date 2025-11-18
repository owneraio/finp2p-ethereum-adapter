// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/cryptography/EIP712.sol)

pragma solidity ^0.8.20;

import "./EarmarkProvider.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract EarmarkEscrow is EarmarkProvider {

    address private owner;
    address private tokenAddress;

    constructor(address _tokenAddress, Earmark memory _emark, string memory _proofSignerFinId)
    EarmarkProvider(_emark, _proofSignerFinId) {
        // Set the contract deployer as the owner
        owner = msg.sender;
        tokenAddress = _tokenAddress;
    }

    function getOwner() external view returns (address) {
        return owner;
    }

    function getTokenAddress() external view returns (address) {
        return tokenAddress;
    }

    // should be called by the owner to deposit tokens into the escrow
    function deposit(uint256 amount) external {
        IERC20 token = IERC20(tokenAddress);
        token.transfer(address(this), amount);
    }

    // should be called by the orchestrator to deposit tokens from the owner into the escrow
    function depositFromOwner(uint256 amount) external {
        IERC20 token = IERC20(tokenAddress);
        token.transferFrom(owner, address(this), amount);
    }

    // should be checked by the orchestrator to verify if the tokens are deposited
    function isDeposited(uint256 amount) external view returns (bool) {
        IERC20 token = IERC20(tokenAddress);
        return token.balanceOf(address(this)) >= amount;
    }

    function release(address to, uint256 amount) external {
        require(earmarkProofProvided, "Earmark proof not provided");

        IERC20 token = IERC20(tokenAddress);
        token.transfer(to, amount);
    }

    function rollback(uint256 amount) external {
        // only while rollback conditions are met
        // TODO: unlock after certain time or other conditions

//        IERC20 token = IERC20(tokenAddress);
//        token.transferFrom(address(this), owner, amount);
    }


}
