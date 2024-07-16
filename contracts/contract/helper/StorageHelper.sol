// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import {LQGStorageInterface} from "../../interface/LQGStorageInterface.sol";

/// @dev NOT USED IN PRODUCTION - Helper contract used to perform manual edits to storage
contract StorageHelper {

    LQGStorageInterface immutable public lqgStorage;

    modifier onlyGuardian() {
        require(msg.sender == lqgStorage.getGuardian(), "Account is not a temporary guardian");
        _;
    }

    // Construct
    constructor(LQGStorageInterface _lqgStorageAddress) {
        lqgStorage = _lqgStorageAddress;
    }

    function getAddress(bytes32 _key) external view returns (address) {
        return lqgStorage.getAddress(_key);
    }

    function getUint(bytes32 _key) external view returns (uint) {
        return lqgStorage.getUint(_key);
    }

    function getString(bytes32 _key) external view returns (string memory) {
        return lqgStorage.getString(_key);
    }

    function getBytes(bytes32 _key) external view returns (bytes memory) {
        return lqgStorage.getBytes(_key);
    }

    function getBool(bytes32 _key) external view returns (bool) {
        return lqgStorage.getBool(_key);
    }

    function getInt(bytes32 _key) external view returns (int) {
        return lqgStorage.getInt(_key);
    }

    function getBytes32(bytes32 _key) external view returns (bytes32) {
        return lqgStorage.getBytes32(_key);
    }

    function setAddress(bytes32 _key, address _value) external onlyGuardian {
        lqgStorage.setAddress(_key, _value);
    }

    function setUint(bytes32 _key, uint _value) external onlyGuardian {
        lqgStorage.setUint(_key, _value);
    }

    function setString(bytes32 _key, string memory _value) external onlyGuardian {
        lqgStorage.setString(_key, _value);
    }

    function setBytes(bytes32 _key, bytes memory _value) external onlyGuardian {
        lqgStorage.setBytes(_key, _value);
    }

    function setBool(bytes32 _key, bool _value) external onlyGuardian {
        lqgStorage.setBool(_key, _value);
    }

    function setInt(bytes32 _key, int _value) external onlyGuardian {
        lqgStorage.setInt(_key, _value);
    }

    function setBytes32(bytes32 _key, bytes32 _value) external onlyGuardian {
        lqgStorage.setBytes32(_key, _value);
    }

    /// @dev Storage delete methods
    function deleteAddress(bytes32 _key) external onlyGuardian {
        lqgStorage.deleteAddress(_key);
    }

    function deleteUint(bytes32 _key) external onlyGuardian {
        lqgStorage.deleteUint(_key);
    }

    function deleteString(bytes32 _key) external onlyGuardian {
        lqgStorage.deleteString(_key);
    }

    function deleteBytes(bytes32 _key) external onlyGuardian {
        lqgStorage.deleteBytes(_key);
    }

    function deleteBool(bytes32 _key) external onlyGuardian {
        lqgStorage.deleteBool(_key);
    }

    function deleteInt(bytes32 _key) external onlyGuardian {
        lqgStorage.deleteInt(_key);
    }

    function deleteBytes32(bytes32 _key) external onlyGuardian {
        lqgStorage.deleteBytes32(_key);
    }

    function addUint(bytes32 _key, uint256 _amount) external onlyGuardian {
        lqgStorage.addUint(_key, _amount);
    }

    function subUint(bytes32 _key, uint256 _amount) external onlyGuardian {
        lqgStorage.subUint(_key, _amount);
    }
}
