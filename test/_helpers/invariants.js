const { LQGNodeManager, LQGMinipoolManager, LQGMinipoolDelegate } = require('../../test/_utils/artifacts');
const { assertBN } = require('./bn');
const assert = require('assert');

async function checkInvariants() {
    const nodeAddresses = await getNodeAddresses();

    for (const nodeAddress of nodeAddresses) {
        const minipools = await getMinipoolsByNode(nodeAddress);
        await checkNodeInvariants(nodeAddress, minipools);
    }
}

async function getNodeAddresses() {
    const lqgNodeManager = await LQGNodeManager.deployed();
    return await lqgNodeManager.getNodeAddresses(0, 1000);
}

async function getMinipoolDetails(address) {
    const minipool = await LQGMinipoolDelegate.at(address);

    const [status, finalised, nodeFee, userDepositBalance, nodeDepositBalance] = await Promise.all([
        minipool.getStatus(),
        minipool.getFinalised(),
        minipool.getNodeFee(),
        minipool.getUserDepositBalance(),
        minipool.getNodeDepositBalance(),
    ]);

    return {
        status: status.toString(),
        finalised,
        nodeFee,
        userDepositBalance,
        nodeDepositBalance
    };
}

async function getMinipoolsByNode(nodeAddress) {
    const lqgMinipoolManager = await LQGMinipoolManager.deployed();
    const count = await lqgMinipoolManager.getNodeMinipoolCount(nodeAddress);
    const minipools = [];
    for (let i = 0; i < count; i++) {
        const address = await lqgMinipoolManager.getNodeMinipoolAt(nodeAddress, i);
        minipools.push(await getMinipoolDetails(address));
    }
    return minipools;
}

async function checkNodeInvariants(nodeAddress, minipools) {
    const lqgMinipoolManager = await LQGMinipoolManager.deployed();
    const lqgNodeManager = await LQGNodeManager.deployed();
    const depositSizes = ['8'.ether, '16'.ether];
    // Filter "staking" minipools
    const stakingMinipools = minipools.filter(minipool => minipool.status === '2' && minipool.finalised === false);
    // Check overall counts
    const [expectedActive, expectedFinalised, expectedStaking] = await Promise.all([
        lqgMinipoolManager.getNodeActiveMinipoolCount(nodeAddress),
        lqgMinipoolManager.getNodeFinalisedMinipoolCount(nodeAddress),
        lqgMinipoolManager.getNodeStakingMinipoolCount(nodeAddress),
    ]);
    const actualActive = minipools.filter(minipool => minipool.finalised !== true).length;
    const actualFinalised = minipools.length - actualActive;
    const actualStaking = stakingMinipools.length;
    assert.equal(actualActive, Number(expectedActive), 'Active minipool count invariant broken');
    assert.equal(actualFinalised, Number(expectedFinalised), 'Finalised minipool count invariant broken');
    assert.equal(actualStaking, Number(expectedStaking), 'Staking minipool count invariant broken');
    // Check deposit size counts
    const countBySize = await Promise.all(depositSizes.map(depositSize => lqgMinipoolManager.getNodeStakingMinipoolCountBySize(nodeAddress, depositSize)));
    for (let i = 0; i < depositSizes.length; i++) {
        const depositSize = depositSizes[i];
        const actualCount = Number(countBySize[i]);
        const expectedCount = stakingMinipools.filter(minipool => minipool.nodeDepositBalance === depositSize).length;
        assert.equal(actualCount, expectedCount, 'Deposit size specific staking minipool count invariant broken');
    }
    // Check weighted average node fee
    const expectedFee = weightedAverage(
        stakingMinipools.map(minipool => minipool.nodeFee),
        stakingMinipools.map(minipool => minipool.userDepositBalance),
    );
    const actualFee = await lqgNodeManager.getAverageNodeFee(nodeAddress);
    assertBN.equal(actualFee, expectedFee, 'Average node fee invariant broken');
}

function weightedAverage(nums, weights) {
    if (nums.length === 0) {
        return 0n;
    }
    const [sum, weightSum] = weights.reduce(
        (acc, w, i) => {
            acc[0] = acc[0] + (nums[i] * w);
            acc[1] = acc[1] + w;
            return acc;
        },
        [0n, 0n],
    );
    return sum / weightSum;
}

module.exports = { checkInvariants };
