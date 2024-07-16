pragma solidity 0.8.18;

// SPDX-License-Identifier: GPL-3.0-only

import "../LQGBase.sol";
import "../../interface/network/LQGNetworkSnapshotsInterface.sol";

// THIS CONTRACT IS NOT DEPLOYED TO MAINNET

// Helper contract used to insert arbitrary snapshots in for testing
contract SnapshotTest is LQGBase {

    LQGNetworkSnapshotsInterface snapshots;

    // Construct
    constructor(LQGStorageInterface _lqgStorageAddress) LQGBase(_lqgStorageAddress) {
        snapshots = LQGNetworkSnapshotsInterface(getContractAddress("lqgNetworkSnapshots"));
    }

    function push(string calldata _key, uint224 _value) external {
        bytes32 key = keccak256(abi.encodePacked(_key));

        snapshots.push(key, _value);
    }

    function lookup(string calldata _key, uint32 _block) external view returns (uint224){
        bytes32 key = keccak256(abi.encodePacked(_key));
        return snapshots.lookup(key, _block);
    }

    function lookupRecent(string calldata _key, uint32 _block, uint256 _recency) external view returns (uint224) {
        bytes32 key = keccak256(abi.encodePacked(_key));
        return snapshots.lookupRecent(key, _block, _recency);
    }

    function lookupGas(string calldata _key, uint32 _block) external view returns (uint256) {
        bytes32 key = keccak256(abi.encodePacked(_key));
        uint256 gasBefore = gasleft();
        snapshots.lookup(key, _block);
        return gasBefore - gasleft();
    }

    function lookupRecentGas(string calldata _key, uint32 _block, uint256 _recency) external view returns (uint256) {
        bytes32 key = keccak256(abi.encodePacked(_key));
        uint256 gasBefore = gasleft();
        snapshots.lookupRecent(key, _block, _recency);
        return gasBefore - gasleft();
    }
}
