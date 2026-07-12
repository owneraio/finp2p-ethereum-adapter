// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Burnable} from "../../utils/erc20/Burnable.sol";

/**
 * @dev Standalone FinP2P escrow.
 *
 * Token-agnostic: works with raw token units and wallet addresses; finId
 * resolution and decimal-string conversion stay with the caller (the plan
 * operator or the adapter). Two deposit paths:
 *  - operator mode: an ESCROW_OPERATOR (e.g. the plan operator contract)
 *    deposits on behalf of a source whose token grants the escrow an
 *    allowance bypass (ERC20WithOperator OPERATOR_ROLE);
 *  - direct mode: the source wallet itself approves the escrow and calls
 *    `deposit` directly.
 *
 * Holds are keyed by operationId and are single-use: a released, rolled-back
 * or burned hold keeps its terminal status forever, so an operationId can
 * never be reused or double-released.
 */
contract FinP2PEscrow is AccessControl {

    bytes32 public constant ESCROW_OPERATOR = keccak256("ESCROW_OPERATOR");

    enum HoldStatus {
        NONE,
        HELD,
        RELEASED,
        ROLLED_BACK,
        BURNED
    }

    struct Hold {
        address token;
        address source;
        address destination; // address(0) = no fixed destination (redeem-style hold)
        uint256 amount;
        HoldStatus status;
    }

    mapping(bytes32 => Hold) private holds;

    event HoldCreated(string operationId, address token, address source, address destination, uint256 amount);
    event HoldReleased(string operationId, address to, uint256 amount);
    event HoldRolledBack(string operationId, uint256 amount);
    event HoldBurned(string operationId, uint256 amount);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ESCROW_OPERATOR, admin);
    }

    function grantEscrowOperatorRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(ESCROW_OPERATOR, account);
    }

    /// @notice Move `amount` of `token` from `source` into escrow under `operationId`.
    /// @dev Callable by the source itself (direct mode, after approve) or an ESCROW_OPERATOR.
    function deposit(
        string calldata operationId,
        address token,
        address source,
        address destination,
        uint256 amount
    ) external {
        require(
            _msgSender() == source || hasRole(ESCROW_OPERATOR, _msgSender()),
            "FinP2PEscrow: caller is not the source or an escrow operator"
        );
        require(token != address(0), "FinP2PEscrow: token cannot be zero");
        require(source != address(0), "FinP2PEscrow: source cannot be zero");
        require(amount > 0, "FinP2PEscrow: amount must be positive");

        bytes32 key = _holdKey(operationId);
        require(holds[key].status == HoldStatus.NONE, "FinP2PEscrow: hold already exists for operationId");

        holds[key] = Hold(token, source, destination, amount, HoldStatus.HELD);
        require(IERC20(token).transferFrom(source, address(this), amount), "FinP2PEscrow: deposit transfer failed");
        emit HoldCreated(operationId, token, source, destination, amount);
    }

    /// @notice Release a hold to its pinned destination. Destinationless
    ///         (redeem-style) holds cannot be released — only burned or rolled
    ///         back — so an unpinned hold can never be redirected to an
    ///         arbitrary address (same semantics as the v1 operator's releaseTo).
    function release(string calldata operationId, address to) external onlyRole(ESCROW_OPERATOR) {
        Hold storage hold = _activeHold(operationId);
        require(hold.destination != address(0), "FinP2PEscrow: hold has no destination; burn or roll back instead");
        require(hold.destination == to, "FinP2PEscrow: release destination differs from the held one");
        hold.status = HoldStatus.RELEASED;
        require(IERC20(hold.token).transfer(to, hold.amount), "FinP2PEscrow: release transfer failed");
        emit HoldReleased(operationId, to, hold.amount);
    }

    /// @notice Return a hold to its source.
    function rollback(string calldata operationId) external onlyRole(ESCROW_OPERATOR) {
        Hold storage hold = _activeHold(operationId);
        hold.status = HoldStatus.ROLLED_BACK;
        require(IERC20(hold.token).transfer(hold.source, hold.amount), "FinP2PEscrow: rollback transfer failed");
        emit HoldRolledBack(operationId, hold.amount);
    }

    /// @notice Burn a held amount (redeem). Requires the token to support
    ///         ERC20Burnable-style `burn(uint256)` of the caller's own balance.
    function releaseAndBurn(string calldata operationId) external onlyRole(ESCROW_OPERATOR) {
        Hold storage hold = _activeHold(operationId);
        hold.status = HoldStatus.BURNED;
        try Burnable(hold.token).burn(hold.amount) {
        } catch {
            revert("FinP2PEscrow: token does not support burning");
        }
        emit HoldBurned(operationId, hold.amount);
    }

    function getHold(string calldata operationId) external view returns (Hold memory) {
        Hold memory hold = holds[_holdKey(operationId)];
        require(hold.status != HoldStatus.NONE, "FinP2PEscrow: hold not found");
        return hold;
    }

    function hasHold(string calldata operationId) external view returns (bool) {
        return holds[_holdKey(operationId)].status == HoldStatus.HELD;
    }

    function _activeHold(string calldata operationId) private view returns (Hold storage hold) {
        hold = holds[_holdKey(operationId)];
        require(hold.status != HoldStatus.NONE, "FinP2PEscrow: hold not found");
        require(hold.status == HoldStatus.HELD, "FinP2PEscrow: hold is not active");
    }

    function _holdKey(string calldata operationId) private pure returns (bytes32) {
        return keccak256(bytes(operationId));
    }
}
