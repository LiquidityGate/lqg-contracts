import {
    LQGNetworkBalances,
    LQGNetworkFees,
    LQGNetworkPrices,
    LQGNetworkVoting,
} from '../_utils/artifacts';

// Get the network total ETH balance
export async function getTotalETHBalance() {
    const lqgNetworkBalances = await LQGNetworkBalances.deployed();
    return lqgNetworkBalances.getTotalETHBalance();
}

// Get the network staking ETH balance
export async function getStakingETHBalance() {
    const lqgNetworkBalances = await LQGNetworkBalances.deployed();
    return lqgNetworkBalances.getStakingETHBalance();
}

// Get the network ETH utilization rate
export async function getETHUtilizationRate() {
    const lqgNetworkBalances = await LQGNetworkBalances.deployed();
    return lqgNetworkBalances.getETHUtilizationRate();
}

// Submit network balances
export async function submitBalances(block, slotTimestamp, totalEth, stakingEth, rethSupply, txOptions) {
    const lqgNetworkBalances = await LQGNetworkBalances.deployed();
    await lqgNetworkBalances.connect(txOptions.from).submitBalances(block, slotTimestamp, totalEth, stakingEth, rethSupply, txOptions);
}

// Submit network token prices
export async function submitPrices(block, slotTimestamp, rplPrice, txOptions) {
    const lqgNetworkPrices = await LQGNetworkPrices.deployed();
    await lqgNetworkPrices.connect(txOptions.from).submitPrices(block, slotTimestamp, rplPrice, txOptions);
}

// Get network RPL price
export async function getRPLPrice() {
    const lqgNetworkPrices = await LQGNetworkPrices.deployed();
    return lqgNetworkPrices.getRPLPrice();
}

// Get the network node demand
export async function getNodeDemand() {
    const lqgNetworkFees = await LQGNetworkFees.deployed();
    return lqgNetworkFees.getNodeDemand();
}

// Get the current network node fee
export async function getNodeFee() {
    const lqgNetworkFees = await LQGNetworkFees.deployed();
    return lqgNetworkFees.getNodeFee();
}

// Get the network node fee for a node demand value
export async function getNodeFeeByDemand(nodeDemand) {
    const lqgNetworkFees = await LQGNetworkFees.deployed();
    return lqgNetworkFees.getNodeFeeByDemand(nodeDemand);
}

export async function setDelegate(nodeAddress, txOptions) {
    const lqgNetworkVoting = await LQGNetworkVoting.deployed();
    await lqgNetworkVoting.connect(txOptions.from).setDelegate(nodeAddress, txOptions);
}

