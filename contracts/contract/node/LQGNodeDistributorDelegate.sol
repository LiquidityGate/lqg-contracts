// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";

import "./LQGNodeDistributorStorageLayout.sol";
import "../../interface/LQGStorageInterface.sol";
import "../../interface/node/LQGNodeManagerInterface.sol";
import "../../interface/node/LQGNodeDistributorInterface.sol";
import "../../interface/node/LQGNodeStakingInterface.sol";

/// @dev Contains the logic for LQGNodeDistributors
contract LQGNodeDistributorDelegate is LQGNodeDistributorStorageLayout, LQGNodeDistributorInterface {
    // Import libraries
    using SafeMath for uint256;

    // Events
    event FeesDistributed(address _nodeAddress, uint256 _userAmount, uint256 _nodeAmount, uint256 _time);

    // Constants
    uint8 public constant version = 2;
    uint256 constant calcBase = 1 ether;

    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    // Precomputed constants
    bytes32 immutable lqgNodeManagerKey;
    bytes32 immutable lqgNodeStakingKey;
    bytes32 immutable lqgTokenRETHKey;

    modifier nonReentrant() {
        require(lock != ENTERED, "Reentrant call");
        lock = ENTERED;
        _;
        lock = NOT_ENTERED;
    }

    constructor() {
        // Precompute storage keys
        lqgNodeManagerKey = keccak256(abi.encodePacked("contract.address", "lqgNodeManager"));
        lqgNodeStakingKey = keccak256(abi.encodePacked("contract.address", "lqgNodeStaking"));
        lqgTokenRETHKey = keccak256(abi.encodePacked("contract.address", "lqgTokenRETH"));
        // These values must be set by proxy contract as this contract should only be delegatecalled
        lqgStorage = LQGStorageInterface(address(0));
        nodeAddress = address(0);
        lock = NOT_ENTERED;
    }

    /// @notice Returns the portion of the contract's balance that belongs to the node operator
    function getNodeShare() override public view returns (uint256) {
        // Get contracts
        LQGNodeManagerInterface lqgNodeManager = LQGNodeManagerInterface(lqgStorage.getAddress(lqgNodeManagerKey));
        LQGNodeStakingInterface lqgNodeStaking = LQGNodeStakingInterface(lqgStorage.getAddress(lqgNodeStakingKey));
        // Get withdrawal address and the node's average node fee
        uint256 averageNodeFee = lqgNodeManager.getAverageNodeFee(nodeAddress);
        // Get node ETH collateral ratio
        uint256 collateralRatio = lqgNodeStaking.getNodeETHCollateralisationRatio(nodeAddress);
        // Calculate reward split
        uint256 nodeBalance = address(this).balance.mul(calcBase).div(collateralRatio);
        uint256 userBalance = address(this).balance.sub(nodeBalance);
        return nodeBalance.add(userBalance.mul(averageNodeFee).div(calcBase));
    }

    /// @notice Returns the portion of the contract's balance that belongs to the users
    function getUserShare() override external view returns (uint256) {
        return address(this).balance.sub(getNodeShare());
    }

    /// @notice Distributes the balance of this contract to its owners
    function distribute() override external nonReentrant {
        // Calculate node share
        uint256 nodeShare = getNodeShare();
        // Transfer node share
        address withdrawalAddress = lqgStorage.getNodeWithdrawalAddress(nodeAddress);
        (bool success,) = withdrawalAddress.call{value : nodeShare}("");
        require(success);
        // Transfer user share
        uint256 userShare = address(this).balance;
        address lqgTokenRETH = lqgStorage.getAddress(lqgTokenRETHKey);
        payable(lqgTokenRETH).transfer(userShare);
        // Emit event
        emit FeesDistributed(nodeAddress, userShare, nodeShare, block.timestamp);
    }

}
