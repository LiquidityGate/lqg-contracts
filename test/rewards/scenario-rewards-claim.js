import { LQGDAOProtocolSettingsRewards, LQGRewardsPool } from '../../test/_utils/artifacts';


// Get the current rewards claim period in blocks
export async function rewardsClaimIntervalTimeGet(txOptions) {
  // Load contracts
  const lqgDAOProtocolSettingsRewards = await LQGDAOProtocolSettingsRewards.deployed();
  return await lqgDAOProtocolSettingsRewards.getClaimIntervalTime.call();
}


// Get the current rewards claimers total
export async function rewardsClaimersPercTotalGet(txOptions) {
  // Load contracts
  const lqgDAOProtocolSettingsRewards = await LQGDAOProtocolSettingsRewards.deployed();
  return await lqgDAOProtocolSettingsRewards.getRewardsClaimersPercTotal.call();
}


// Get how many seconds needed until the next claim interval
export async function rewardsClaimIntervalsPassedGet(txOptions) {
  // Load contracts
  const lqgRewardsPool = await LQGRewardsPool.deployed();
  return await lqgRewardsPool.getClaimIntervalsPassed.call();
}
