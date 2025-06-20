pragma solidity 0.7.6;

// SPDX-License-Identifier: GPL-3.0-only

import "../LQGBase.sol";
import "../../interface/minipool/LQGMinipoolPenaltyInterface.sol";

// THIS CONTRACT IS NOT DEPLOYED TO MAINNET

// Helper contract used in unit tests that can set the penalty rate on a minipool (a feature that will be implemented at a later time)
contract PenaltyTest is LQGBase {
    // Construct
    constructor(LQGStorageInterface _lqgStorageAddress) LQGBase(_lqgStorageAddress) {
    }

    // Sets the penalty rate for the given minipool
    function setPenaltyRate(address _minipoolAddress, uint256 _rate) external {
        LQGMinipoolPenaltyInterface lqgMinipoolPenalty = LQGMinipoolPenaltyInterface(getContractAddress("lqgMinipoolPenalty"));
        lqgMinipoolPenalty.setPenaltyRate(_minipoolAddress, _rate);
    }
}
