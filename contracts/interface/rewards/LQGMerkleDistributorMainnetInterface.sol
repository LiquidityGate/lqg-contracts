// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >0.5.0 <0.9.0;

import "./LQGRewardsRelayInterface.sol";

interface LQGMerkleDistributorMainnetInterface is LQGRewardsRelayInterface {
    function claimOutstandingEth() external;
    function getOutstandingEth(address _address) external view returns (uint256);
}
