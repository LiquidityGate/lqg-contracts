pragma solidity >0.5.0 <0.9.0;

// SPDX-License-Identifier: GPL-3.0-only

interface LQGNetworkPenaltiesInterface {
    function submitPenalty(address _minipoolAddress, uint256 _block) external;
    function executeUpdatePenalty(address _minipoolAddress, uint256 _block) external;
    function getPenaltyCount(address _minipoolAddress) external view returns (uint256);
}
