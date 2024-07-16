pragma solidity 0.7.6;

import "../../interface/LQGStorageInterface.sol";

// SPDX-License-Identifier: GPL-3.0-only

abstract contract LQGNodeDistributorStorageLayout {
    LQGStorageInterface lqgStorage;
    address nodeAddress;
    uint256 lock;   // Reentrancy guard
}