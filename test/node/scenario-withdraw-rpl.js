import {
    LQGDAOProtocolSettingsMinipool,
    LQGDAOProtocolSettingsNode,
    LQGMinipoolManager,
    LQGNetworkPrices,
    LQGNodeManager,
    LQGNodeStaking,
    LQGTokenRPL,
    LQGVault,
} from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';

// Withdraw RPL staked against the node
export async function withdrawRpl(amount, txOptions) {
    // Load contracts
    const [
        lqgMinipoolManager,
        lqgNetworkPrices,
        lqgDAOProtocolSettingsNode,
        lqgNodeManager,
        lqgNodeStaking,
        lqgTokenRPL,
        lqgVault,
    ] = await Promise.all([
        LQGMinipoolManager.deployed(),
        LQGNetworkPrices.deployed(),
        LQGDAOProtocolSettingsNode.deployed(),
        LQGNodeManager.deployed(),
        LQGNodeStaking.deployed(),
        LQGTokenRPL.deployed(),
        LQGVault.deployed(),
    ]);

    // Get parameters
    const [
        minPerMinipoolStake,
        maxPerMinipoolStake,
        rplPrice,
        rplWithdrawalAddress,
    ] = await Promise.all([
        lqgDAOProtocolSettingsNode.getMinimumPerMinipoolStake(),
        lqgDAOProtocolSettingsNode.getMaximumPerMinipoolStake(),
        lqgNetworkPrices.getRPLPrice(),
        lqgNodeManager.getNodeRPLWithdrawalAddress(txOptions.from.address),
    ]);

    // Get token balances
    function getTokenBalances(nodeAddress) {
        return Promise.all([
            lqgTokenRPL.balanceOf(nodeAddress),
            lqgTokenRPL.balanceOf(lqgVault.target),
            lqgVault.balanceOfToken('lqgNodeStaking', lqgTokenRPL.target),
        ]).then(
            ([nodeRpl, vaultRpl, stakingRpl]) =>
                ({ nodeRpl, vaultRpl, stakingRpl }),
        );
    }

    // Get staking details
    function getStakingDetails(nodeAddress) {
        return Promise.all([
            lqgNodeStaking.getTotalRPLStake(),
            lqgNodeStaking.getNodeRPLStake(nodeAddress),
            lqgNodeStaking.getNodeEffectiveRPLStake(nodeAddress),
            lqgNodeStaking.getNodeETHMatched(nodeAddress),
            lqgNodeStaking.getNodeETHMatchedLimit(nodeAddress),
        ]).then(
            ([totalStake, nodeStake, nodeEffectiveStake, nodeEthMatched, nodeEthMatchedLimit]) =>
                ({ totalStake, nodeStake, nodeEffectiveStake, nodeEthMatched, nodeEthMatchedLimit }),
        );
    }

    // Get minipool counts
    function getMinipoolCounts(nodeAddress) {
        return Promise.all([
            lqgMinipoolManager.getMinipoolCount(),
            lqgMinipoolManager.getNodeMinipoolCount(nodeAddress),
        ]).then(
            ([total, node]) =>
                ({ total, node }),
        );
    }

    // Get initial token balances & staking details
    let [balances1, details1] = await Promise.all([
        getTokenBalances(rplWithdrawalAddress),
        getStakingDetails(txOptions.from),
    ]);

    // Withdraw RPL
    await lqgNodeStaking.connect(txOptions.from)['withdrawRPL(uint256)'](amount, txOptions);

    // Get updated token balances, staking details & minipool counts
    let [balances2, details2, minipoolCounts] = await Promise.all([
        getTokenBalances(rplWithdrawalAddress),
        getStakingDetails(txOptions.from),
        getMinipoolCounts(txOptions.from),
    ]);

    // Calculate expected effective stakes & node minipool limit
    const maxNodeEffectiveStake = details2.nodeEthMatched * maxPerMinipoolStake / rplPrice;
    const expectedNodeEffectiveStake = (details2.nodeStake < maxNodeEffectiveStake) ? details2.nodeStake : maxNodeEffectiveStake;
    const expectedNodeEthMatchedLimit = details2.nodeStake * rplPrice / minPerMinipoolStake;

    // Check token balances
    assertBN.equal(balances2.nodeRpl, balances1.nodeRpl + amount, 'Incorrect updated node RPL balance');
    assertBN.equal(balances2.vaultRpl, balances1.vaultRpl - amount, 'Incorrect updated vault RPL balance');
    assertBN.equal(balances2.stakingRpl, balances1.stakingRpl - amount, 'Incorrect updated LQGNodeStaking contract RPL vault balance');

    // Check staking details
    assertBN.equal(details2.totalStake, details1.totalStake - amount, 'Incorrect updated total RPL stake');
    assertBN.equal(details2.nodeStake, details1.nodeStake - amount, 'Incorrect updated node RPL stake');
    assertBN.equal(details2.nodeEffectiveStake, expectedNodeEffectiveStake, 'Incorrect updated effective node RPL stake');
    assertBN.equal(details2.nodeEthMatchedLimit, expectedNodeEthMatchedLimit, 'Incorrect updated node minipool limit');
}
