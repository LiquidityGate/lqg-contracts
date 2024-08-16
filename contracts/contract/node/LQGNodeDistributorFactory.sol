pragma solidity 0.7.6;

// SPDX-License-Identifier: GPL-3.0-only

import "../LQGBase.sol";
import "./LQGNodeDistributor.sol";
import "./LQGNodeDistributorStorageLayout.sol";
import "../../interface/node/LQGNodeDistributorFactoryInterface.sol";

contract LQGNodeDistributorFactory is LQGBase, LQGNodeDistributorFactoryInterface {
    // Events
    event ProxyCreated(address _address);

    // Construct
    constructor(LQGStorageInterface _lqgStorageAddress) LQGBase(_lqgStorageAddress) {
        version = 1;
    }

    function getProxyBytecode() override public pure returns (bytes memory) {
        return type(LQGNodeDistributor).creationCode;
    }

    // Calculates the predetermined distributor contract address from given node address
    function getProxyAddress(address _nodeAddress) override external view returns(address) {
        bytes memory contractCode = getProxyBytecode();
        bytes memory initCode = abi.encodePacked(contractCode, abi.encode(_nodeAddress, lqgStorage));

        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), uint256(0), keccak256(initCode)));

        return address(uint160(uint(hash)));
    }

    // Uses CREATE2 to deploy a LQGNodeDistributor at predetermined address
    function createProxy(address _nodeAddress) override external onlyLatestContract("lqgNodeManager", msg.sender) {
        // Salt is not required as the initCode is already unique per node address (node address is constructor argument)
        LQGNodeDistributor dist = new LQGNodeDistributor{salt: ''}(_nodeAddress, address(lqgStorage));
        emit ProxyCreated(address(dist));
    }
}
