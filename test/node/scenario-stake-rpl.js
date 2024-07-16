import {
    LQGDAOProtocolSettingsNode,
    LQGNetworkPrices,
    LQGNodeStaking,
    LQGTokenRPL,
    LQGVault,
} from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';

// Stake RPL against the node
export async function stakeRpl(amount, txOptions) {
    // Load contracts
    const [
        lqgNetworkPrices,
        lqgDAOProtocolSettingsNode,
        lqgNodeStaking,
        lqgTokenRPL,
        lqgVault,
    ] = await Promise.all([
        LQGNetworkPrices.deployed(),
        LQGDAOProtocolSettingsNode.deployed(),
        LQGNodeStaking.deployed(),
        LQGTokenRPL.deployed(),
        LQGVault.deployed(),
    ]);

    // Get parameters
    const [
        minPerMinipoolStake,
        maxPerMinipoolStake,
        rplPrice,
    ] = await Promise.all([
        lqgDAOProtocolSettingsNode.getMinimumPerMinipoolStake(),
        lqgDAOProtocolSettingsNode.getMaximumPerMinipoolStake(),
        lqgNetworkPrices.getRPLPrice(),
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
            lqgNodeStaking.getNodeETHProvided(nodeAddress),
        ]).then(
            ([totalStake, nodeStake, nodeEffectiveStake, nodeEthMatched, nodeEthMatchedLimit, nodeEthProvided]) =>
                ({ totalStake, nodeStake, nodeEffectiveStake, nodeEthMatched, nodeEthMatchedLimit, nodeEthProvided }),
        );
    }

    // Get initial token balances & staking details
    let [balances1, details1] = await Promise.all([
        getTokenBalances(txOptions.from),
        getStakingDetails(txOptions.from),
    ]);

    // Stake RPL
    await lqgNodeStaking.connect(txOptions.from).stakeRPL(amount, txOptions);

    // Get updated token balances, staking details & minipool counts
    let [balances2, details2] = await Promise.all([
        getTokenBalances(txOptions.from),
        getStakingDetails(txOptions.from),
    ]);

    // Calculate expected effective stakes & node minipool limit
    const maxNodeEffectiveStake = details2.nodeEthProvided * maxPerMinipoolStake / rplPrice;
    const expectedNodeEffectiveStake = (details2.nodeStake < maxNodeEffectiveStake) ? details2.nodeStake : maxNodeEffectiveStake;
    const expectedNodeEthMatchedLimit = details2.nodeStake * rplPrice / minPerMinipoolStake;

    // Check token balances
    assertBN.equal(balances2.nodeRpl, balances1.nodeRpl - amount, 'Incorrect updated node RPL balance');
    assertBN.equal(balances2.vaultRpl, balances1.vaultRpl + amount, 'Incorrect updated vault RPL balance');
    assertBN.equal(balances2.stakingRpl, balances1.stakingRpl + amount, 'Incorrect updated LQGNodeStaking contract RPL vault balance');

    // Check staking details
    assertBN.equal(details2.totalStake, details1.totalStake + amount, 'Incorrect updated total RPL stake');
    assertBN.equal(details2.nodeStake, details1.nodeStake + amount, 'Incorrect updated node RPL stake');
    assertBN.equal(details2.nodeEffectiveStake, expectedNodeEffectiveStake, 'Incorrect updated effective node RPL stake');
    assertBN.equal(details2.nodeEthMatchedLimit, expectedNodeEthMatchedLimit, 'Incorrect updated node minipool limit');
}
