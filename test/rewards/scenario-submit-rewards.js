import {
    LQGClaimDAO,
    LQGDAONodeTrusted,
    LQGRewardsPool,
    LQGTokenRETH,
    LQGTokenRPL,
} from '../_utils/artifacts';
import { parseRewardsMap } from '../_utils/merkle-tree';
import { assertBN } from '../_helpers/bn';
import * as assert from 'assert';

const hre = require('hardhat');
const ethers = hre.ethers;

// Submit rewards
export async function submitRewards(index, rewards, treasuryRPL, userETH, txOptions) {
    // Load contracts
    const [
        lqgDAONodeTrusted,
        lqgRewardsPool,
        lqgTokenRETH,
        lqgTokenRPL,
        lqgClaimDAO,
    ] = await Promise.all([
        LQGDAONodeTrusted.deployed(),
        LQGRewardsPool.deployed(),
        LQGTokenRETH.deployed(),
        LQGTokenRPL.deployed(),
        LQGClaimDAO.deployed(),
    ]);

    // Get parameters
    let trustedNodeCount = await lqgDAONodeTrusted.getMemberCount();

    // Construct the merkle tree
    let treeData = parseRewardsMap(rewards);

    const trustedNodeRPL = [];
    const nodeRPL = [];
    const nodeETH = [];

    let maxNetwork = rewards.reduce((a, b) => Math.max(a, b.network), 0);

    for (let i = 0; i <= maxNetwork; i++) {
        trustedNodeRPL[i] = 0n;
        nodeRPL[i] = 0n;
        nodeETH[i] = 0n;
    }

    for (let i = 0; i < rewards.length; i++) {
        trustedNodeRPL[rewards[i].network] = trustedNodeRPL[rewards[i].network] + rewards[i].trustedNodeRPL;
        nodeRPL[rewards[i].network] = nodeRPL[rewards[i].network] + rewards[i].nodeRPL;
        nodeETH[rewards[i].network] = nodeETH[rewards[i].network] + rewards[i].nodeETH;
    }

    // // web3 doesn't like an array of BigNumbers, have to convert to dec string
    // for (let i = 0; i <= maxNetwork; i++) {
    //     trustedNodeRPL[i] = trustedNodeRPL[i].toString();
    //     nodeRPL[i] = nodeRPL[i].toString();
    //     nodeETH[i] = nodeETH[i].toString();
    // }

    const root = treeData.proof.merkleRoot;
    const cid = '0';

    const submission = {
        rewardIndex: index,
        executionBlock: '0',
        consensusBlock: '0',
        merkleRoot: root,
        merkleTreeCID: cid,
        intervalsPassed: '1',
        treasuryRPL: treasuryRPL,
        trustedNodeRPL: trustedNodeRPL,
        nodeRPL: nodeRPL,
        nodeETH: nodeETH,
        userETH: userETH,
    };

    // Get submission details
    function getSubmissionDetails() {
        return Promise.all([
            lqgRewardsPool.getTrustedNodeSubmitted(txOptions.from.address, index),
            lqgRewardsPool.getSubmissionCount(submission),
        ]).then(
            ([nodeSubmitted, count]) =>
                ({ nodeSubmitted, count }),
        );
    }

    // Get initial submission details
    let [submission1, rewardIndex1, treasuryRpl1, rethBalance1] = await Promise.all([
        getSubmissionDetails(),
        lqgRewardsPool.getRewardIndex(),
        lqgTokenRPL.balanceOf(lqgClaimDAO.target),
        ethers.provider.getBalance(lqgTokenRETH.target),
    ]);

    let alreadyExecuted = submission.rewardIndex !== Number(rewardIndex1);
    // Submit prices
    await lqgRewardsPool.connect(txOptions.from).submitRewardSnapshot(submission, txOptions);
    const actualExecutionBlock = await ethers.provider.getBlockNumber();
    assert.equal(await lqgRewardsPool.getSubmissionFromNodeExists(txOptions.from.address, submission), true);

    // Get updated submission details & prices
    let [submission2, rewardIndex2, treasuryRpl2, rethBalance2] = await Promise.all([
        getSubmissionDetails(),
        lqgRewardsPool.getRewardIndex(),
        lqgTokenRPL.balanceOf(lqgClaimDAO.target),
        ethers.provider.getBalance(lqgTokenRETH.target),
    ]);

    // Check if prices should be updated and were not updated yet
    let expectedExecute = (submission2.count * 2n) > trustedNodeCount && !alreadyExecuted;
    // Check submission details
    assert.equal(submission1.nodeSubmitted, false, 'Incorrect initial node submitted status');
    assert.equal(submission2.nodeSubmitted, true, 'Incorrect updated node submitted status');
    assertBN.equal(submission2.count, submission1.count + 1n, 'Incorrect updated submission count');

    // Calculate changes in user ETH and treasury RPL
    let userETHChange = rethBalance2 - rethBalance1;
    let treasuryRPLChange = treasuryRpl2 - treasuryRpl1;

    // Check reward index and user balances
    if (expectedExecute) {
        assertBN.equal(rewardIndex2, rewardIndex1 + 1n, 'Incorrect updated network prices block');
        assertBN.equal(userETHChange, userETH, 'User ETH balance not correct');
        assertBN.equal(treasuryRPLChange, treasuryRPL, 'Treasury RPL balance not correct');

        // Check block and address
        const executionBlock = await lqgRewardsPool.getClaimIntervalExecutionBlock(index);
        const executionAddress = await lqgRewardsPool.getClaimIntervalExecutionAddress(index);
        assert.equal(executionBlock, actualExecutionBlock);
        assert.equal(executionAddress, lqgRewardsPool.target);
    } else {
        assertBN.equal(rewardIndex2, rewardIndex1, 'Incorrect updated network prices block');
        assertBN.equal(rethBalance1, rethBalance2, 'User ETH balance changed');
        assertBN.equal(treasuryRpl1, treasuryRpl2, 'Treasury RPL balance changed');
    }
}

// Execute a reward period that already has consensus
export async function executeRewards(index, rewards, treasuryRPL, userETH, txOptions) {
    // Load contracts
    const [
        lqgRewardsPool,
    ] = await Promise.all([
        LQGRewardsPool.deployed(),
    ]);

    // Construct the merkle tree
    let treeData = parseRewardsMap(rewards);

    const trustedNodeRPL = [];
    const nodeRPL = [];
    const nodeETH = [];

    let maxNetwork = rewards.reduce((a, b) => Math.max(a, b.network), 0);

    for (let i = 0; i <= maxNetwork; i++) {
        trustedNodeRPL[i] = 0n;
        nodeRPL[i] = 0n;
        nodeETH[i] = 0n;
    }

    for (let i = 0; i < rewards.length; i++) {
        trustedNodeRPL[rewards[i].network] = trustedNodeRPL[rewards[i].network] + rewards[i].trustedNodeRPL;
        nodeRPL[rewards[i].network] = nodeRPL[rewards[i].network] + rewards[i].nodeRPL;
        nodeETH[rewards[i].network] = nodeETH[rewards[i].network] + rewards[i].nodeETH;
    }

    // // web3 doesn't like an array of BigNumbers, have to convert to dec string
    // for (let i = 0; i <= maxNetwork; i++) {
    //     trustedNodeRPL[i] = trustedNodeRPL[i].toString();
    //     nodeRPL[i] = nodeRPL[i].toString();
    //     nodeETH[i] = nodeETH[i].toString();
    // }

    const root = treeData.proof.merkleRoot;
    const cid = '0';

    const submission = {
        rewardIndex: index,
        executionBlock: 0,
        consensusBlock: 0,
        merkleRoot: root,
        merkleTreeCID: cid,
        intervalsPassed: 1,
        treasuryRPL: treasuryRPL,
        trustedNodeRPL: trustedNodeRPL,
        nodeRPL: nodeRPL,
        nodeETH: nodeETH,
        userETH: userETH,
    };

    // Submit prices
    let rewardIndex1 = await lqgRewardsPool.getRewardIndex();
    await lqgRewardsPool.connect(txOptions.from).executeRewardSnapshot(submission, txOptions);
    let rewardIndex2 = await lqgRewardsPool.getRewardIndex();

    // Check index incremented
    assertBN.equal(rewardIndex2, rewardIndex1 + 1n, 'Incorrect updated network prices block');
}
