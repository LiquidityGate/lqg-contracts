// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import "@openzeppelin4/contracts/utils/math/Math.sol";

import "../LQGBase.sol";
import "../../interface/network/LQGNetworkSnapshotsInterface.sol";
import "../../interface/dao/protocol/settings/LQGDAOProtocolSettingsMinipoolInterface.sol";
import "../../interface/node/LQGNodeStakingInterface.sol";
import "../../interface/dao/protocol/settings/LQGDAOProtocolSettingsNodeInterface.sol";
import "../../interface/network/LQGNetworkPricesInterface.sol";
import "../../interface/minipool/LQGMinipoolManagerInterface.sol";
import "../../interface/util/AddressSetStorageInterface.sol";
import "../../interface/network/LQGNetworkVotingInterface.sol";
import "../../interface/node/LQGNodeManagerInterface.sol";

/// @notice Accounting for snapshotting of governance related values based on block numbers
contract LQGNetworkVoting is LQGBase, LQGNetworkVotingInterface {

    // Constants
    bytes32 immutable internal priceKey;

    // Events
    event DelegateSet(address nodeOperator, address delegate, uint256 time);

    constructor(LQGStorageInterface _lqgStorageAddress) LQGBase(_lqgStorageAddress) {
        version = 2;
        // Precompute keys
        priceKey = keccak256("network.prices.rpl");
    }

    /// @notice Unlocks a given node operator's voting power if they haven't already done so.
    ///         Sets their delegate to themself.
    /// @param _nodeAddress The address of the node to initialise
    function initialiseVotingFor(address _nodeAddress) onlyRegisteredNode(_nodeAddress) external override {
        if (!getBool(keccak256(abi.encodePacked("node.voting.enabled", _nodeAddress)))) {
            _initialiseVoting(_nodeAddress, _nodeAddress);
        }
    }

    /// @notice Unlocks a node operator's voting power (only required for node operators who registered before
    ///         governance structure was in place). Sets delegate to self.
    function initialiseVoting() onlyRegisteredNode(msg.sender) external override {
        _initialiseVoting(msg.sender, msg.sender);
    }

    /// @notice Unlocks a node operator's voting power (only required for node operators who registered before
    ///         governance structure was in place).
    /// @param _delegate The node operator's desired delegate for their voting power
    function initialiseVotingWithDelegate(address _delegate) onlyRegisteredNode(msg.sender) onlyRegisteredNode(_delegate) external override {
        _initialiseVoting(msg.sender, _delegate);
    }

    /// @dev Initialises the snapshot values for the caller to participate in the on-chain governance
    /// @param _nodeAddress The address of the node to initialise
    /// @param _delegate The address to delegate the node's voting power to
    function _initialiseVoting(address _nodeAddress, address _delegate) private {
        // Check if already initialised
        require (!getBool(keccak256(abi.encodePacked("node.voting.enabled", _nodeAddress))), "Voting power already initialised");
        setBool(keccak256(abi.encodePacked("node.voting.enabled", _nodeAddress)), true);

        // Get contracts
        LQGNetworkSnapshotsInterface lqgNetworkSnapshots = LQGNetworkSnapshotsInterface(getContractAddress("lqgNetworkSnapshots"));
        LQGNodeStakingInterface lqgNodeStaking = LQGNodeStakingInterface(getContractAddress("lqgNodeStaking"));
        LQGMinipoolManagerInterface lqgMinipoolManager = LQGMinipoolManagerInterface(getContractAddress("lqgMinipoolManager"));

        bytes32 key;

        // ETH matched
        key = keccak256(abi.encodePacked("eth.matched.node.amount", _nodeAddress));
        lqgNetworkSnapshots.push(key, uint224(lqgNodeStaking.getNodeETHMatched(_nodeAddress)));

        // Active minipools
        key = keccak256(abi.encodePacked("minipools.active.count", _nodeAddress));
        lqgNetworkSnapshots.push(key, uint224(lqgMinipoolManager.getNodeActiveMinipoolCount(_nodeAddress)));

        // RPL staked
        key = keccak256(abi.encodePacked("rpl.staked.node.amount", _nodeAddress));
        lqgNetworkSnapshots.push(key, uint224(lqgNodeStaking.getNodeRPLStake(_nodeAddress)));

        // Set starting delegate to themself
        key = keccak256(abi.encodePacked("node.delegate", _nodeAddress));
        lqgNetworkSnapshots.push(key, uint224(uint160(_delegate)));
    }

    /// @notice Returns true if the given node has initialised their voting power
    /// @param _nodeAddress The address of the node to query
    function getVotingInitialised(address _nodeAddress) external override view returns (bool) {
        return getBool(keccak256(abi.encodePacked("node.voting.enabled", _nodeAddress)));
    }

    /// @notice Returns the number of registered nodes at a given block
    /// @param _block Block number to query
    function getNodeCount(uint32 _block) external override view returns (uint256) {
        // Get contracts
        LQGNetworkSnapshotsInterface lqgNetworkSnapshots = LQGNetworkSnapshotsInterface(getContractAddress("lqgNetworkSnapshots"));
        bytes32 key = keccak256(abi.encodePacked("node.count"));
        return uint256(lqgNetworkSnapshots.lookupRecent(key, _block, 10));
    }

    /// @notice Returns the voting power of a given node operator at a specified block
    /// @param _nodeAddress Address of the node operator
    /// @param _block Block number to query
    function getVotingPower(address _nodeAddress, uint32 _block) external override view returns (uint256) {
        // Validate block number
        require(_block <= block.number, "Block must be in the past");

        // Check if the node operator has enabled voting
        if (!getBool(keccak256(abi.encodePacked("node.voting.enabled", _nodeAddress)))) {
            return 0;
        }

        // Get contracts
        LQGNetworkSnapshotsInterface lqgNetworkSnapshots = LQGNetworkSnapshotsInterface(getContractAddress("lqgNetworkSnapshots"));
        LQGDAOProtocolSettingsMinipoolInterface lqgDAOProtocolSettingsMinipool = LQGDAOProtocolSettingsMinipoolInterface(getContractAddress("lqgDAOProtocolSettingsMinipool"));

        // Setup
        bytes32 key;

        // Get ETH matched
        key = keccak256(abi.encodePacked("eth.matched.node.amount", _nodeAddress));
        uint256 ethMatched = uint256(lqgNetworkSnapshots.lookupRecent(key, _block, 5));

        // Get active minipools to calculate ETH provided
        key = keccak256(abi.encodePacked("minipools.active.count", _nodeAddress));
        uint256 activeMinipools = lqgNetworkSnapshots.lookupRecent(key, _block, 5);
        uint256 launchAmount = lqgDAOProtocolSettingsMinipool.getLaunchBalance();
        uint256 totalEthStaked = activeMinipools * launchAmount;
        uint256 ethProvided = totalEthStaked - ethMatched;

        // Get RPL price
        uint256 rplPrice = uint256(lqgNetworkSnapshots.lookupRecent(priceKey, _block, 14));

        // Get RPL staked by node operator
        key = keccak256(abi.encodePacked("rpl.staked.node.amount", _nodeAddress));
        uint256 rplStake = uint256(lqgNetworkSnapshots.lookupRecent(key, _block, 5));

        // Get RPL max stake percent
        key = keccak256(bytes("node.voting.power.stake.maximum"));
        uint256 maximumStakePercent = uint256(lqgNetworkSnapshots.lookupRecent(key, _block, 2));

        return calculateVotingPower(rplStake, ethProvided, rplPrice, maximumStakePercent);
    }

    /// @dev Calculates and returns a node's voting power based on the given inputs
    function calculateVotingPower(uint256 _rplStake, uint256 _providedETH, uint256 _rplPrice, uint256 _maxStakePercent) internal pure returns (uint256) {
        // Get contracts
        uint256 maximumStake = _providedETH * _maxStakePercent / _rplPrice;
        if (_rplStake > maximumStake) {
            _rplStake = maximumStake;
        }
        // Return the calculated voting power as the square root of clamped RPL stake
        return Math.sqrt(_rplStake * calcBase);
    }

    /// @notice Called by a registered node to set their delegate address
    /// @param _newDelegate The address of the node operator to delegate voting power to
    function setDelegate(address _newDelegate) external override onlyRegisteredNode(msg.sender) onlyRegisteredNode(_newDelegate) {
        LQGNetworkSnapshotsInterface lqgNetworkSnapshots = LQGNetworkSnapshotsInterface(getContractAddress("lqgNetworkSnapshots"));
        bytes32 key = keccak256(abi.encodePacked("node.delegate", msg.sender));
        lqgNetworkSnapshots.push(key, uint224(uint160(_newDelegate)));
        emit DelegateSet(msg.sender, _newDelegate, block.timestamp);
    }

    /// @notice Returns the address of the node operator that the given node operator has delegated to at a given block
    /// @param _nodeAddress Address of the node operator to query
    /// @param _block The block number to query
    function getDelegate(address _nodeAddress, uint32 _block) external override view returns (address) {
        LQGNetworkSnapshotsInterface lqgNetworkSnapshots = LQGNetworkSnapshotsInterface(getContractAddress("lqgNetworkSnapshots"));
        bytes32 key = keccak256(abi.encodePacked("node.delegate", _nodeAddress));
        return address(uint160(lqgNetworkSnapshots.lookupRecent(key, _block, 10)));
    }

    /// @notice Returns the address of the node operator that the given node operator is currently delegate to
    /// @param _nodeAddress Address of the node operator to query
    function getCurrentDelegate(address _nodeAddress) external override view returns (address) {
        LQGNetworkSnapshotsInterface lqgNetworkSnapshots = LQGNetworkSnapshotsInterface(getContractAddress("lqgNetworkSnapshots"));
        bytes32 key = keccak256(abi.encodePacked("node.delegate", _nodeAddress));
        return address(uint160(lqgNetworkSnapshots.latestValue(key)));
    }
}
