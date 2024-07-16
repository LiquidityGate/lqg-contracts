// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

import "../LQGBase.sol";
import "../../interface/minipool/LQGMinipoolBaseInterface.sol";
import "../../interface/minipool/LQGMinipoolFactoryInterface.sol";

/// @notice Performs CREATE2 deployment of minipool contracts
contract LQGMinipoolFactory is LQGBase, LQGMinipoolFactoryInterface {

    // Libs
    using SafeMath for uint;
    using Clones for address;

    constructor(LQGStorageInterface _lqgStorageAddress) LQGBase(_lqgStorageAddress) {
        version = 2;
    }

    /// @notice Returns the expected minipool address for a node operator given a user-defined salt
    /// @param _salt The salt used in minipool creation
    function getExpectedAddress(address _nodeOperator, uint256 _salt) external override view returns (address) {
        // Ensure lqgMinipoolBase is setAddress
        address lqgMinipoolBase = lqgStorage.getAddress(keccak256(abi.encodePacked("contract.address", "lqgMinipoolBase")));
        // Calculate node specific salt value
        bytes32 salt = keccak256(abi.encodePacked(_nodeOperator, _salt));
        // Return expected address
        return lqgMinipoolBase.predictDeterministicAddress(salt, address(this));
    }

    /// @notice Performs a CREATE2 deployment of a minipool contract with given salt
    /// @param _nodeAddress Owning node operator's address
    /// @param _salt A salt used in determining minipool address
    function deployContract(address _nodeAddress, uint256 _salt) override external onlyLatestContract("lqgMinipoolFactory", address(this)) onlyLatestContract("lqgMinipoolManager", msg.sender) returns (address) {
        // Ensure lqgMinipoolBase is setAddress
        address lqgMinipoolBase = lqgStorage.getAddress(keccak256(abi.encodePacked("contract.address", "lqgMinipoolBase")));
        require(lqgMinipoolBase != address(0));
        // Construct final salt
        bytes32 salt = keccak256(abi.encodePacked(_nodeAddress, _salt));
        // Deploy the minipool
        address proxy = lqgMinipoolBase.cloneDeterministic(salt);
        // Initialise the minipool storage
        LQGMinipoolBaseInterface(proxy).initialise(address(lqgStorage), _nodeAddress);
        // Return address
        return proxy;
    }

}
