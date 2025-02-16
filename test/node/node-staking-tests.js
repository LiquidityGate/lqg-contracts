import { before, describe, it } from 'mocha';
import {
    LQGDAONodeTrustedSettingsMinipool,
    LQGDAOProtocolSettingsRewards,
    LQGNodeStaking,
} from '../_utils/artifacts';
import { printTitle } from '../_utils/formatting';
import { shouldRevert } from '../_utils/testing';
import {
    nodeDeposit,
    nodeStakeRPL,
    nodeStakeRPLFor,
    registerNode,
    setNodeRPLWithdrawalAddress,
    setNodeTrusted,
    setNodeWithdrawalAddress,
    setStakeRPLForAllowed,
    setStakeRPLForAllowedWithNodeAddress,
} from '../_helpers/node';
import { approveRPL, mintRPL } from '../_helpers/tokens';
import { stakeRpl } from './scenario-stake-rpl';
import { withdrawRpl } from './scenario-withdraw-rpl';
import { createMinipool, stakeMinipool } from '../_helpers/minipool';
import { beginUserDistribute, withdrawValidatorBalance } from '../minipool/scenario-withdraw-validator-balance';
import { userDeposit } from '../_helpers/deposit';
import { setDAONodeTrustedBootstrapSetting } from '../dao/scenario-dao-node-trusted-bootstrap';
import { setDAOProtocolBootstrapSetting } from '../dao/scenario-dao-protocol-bootstrap';
import { globalSnapShot } from '../_utils/snapshotting';

const helpers = require('@nomicfoundation/hardhat-network-helpers');
const hre = require('hardhat');
const ethers = hre.ethers;

export default function() {
    describe('LQGNodeStaking', () => {
        let owner,
            node,
            trustedNode,
            random,
            rplWithdrawalAddress,
            withdrawalAddress;

        const scrubPeriod = (60 * 60 * 24); // 24 hours
        const userDistributeStartTime = 60 * 60 * 24 * 90; // 90 days

        // Setup
        let lqgNodeStaking;
        before(async () => {
            await globalSnapShot();

            [
                owner,
                node,
                trustedNode,
                random,
                rplWithdrawalAddress,
                withdrawalAddress,
            ] = await ethers.getSigners();

            // Load contracts
            lqgNodeStaking = await LQGNodeStaking.deployed();

            // Set settings
            await setDAONodeTrustedBootstrapSetting(LQGDAONodeTrustedSettingsMinipool, 'minipool.scrub.period', scrubPeriod, { from: owner });

            // Register node
            await registerNode({ from: node });

            // Register trusted node
            await registerNode({ from: trustedNode });
            await setNodeTrusted(trustedNode, 'saas_1', 'node1@home.com', owner);

            // Mint RPL to accounts
            const rplAmount = '10000'.ether;
            await mintRPL(owner, node, rplAmount);
            await mintRPL(owner, random, rplAmount);
            await mintRPL(owner, rplWithdrawalAddress, rplAmount);
            await mintRPL(owner, withdrawalAddress, rplAmount);

        });

        it(printTitle('node operator', 'can stake RPL'), async () => {
            // Set parameters
            const rplAmount = '5000'.ether;

            // Approve transfer & stake RPL once
            await approveRPL(lqgNodeStaking.target, rplAmount, { from: node });
            await stakeRpl(rplAmount, {
                from: node,
            });

            // Make node deposit / create minipool
            await nodeDeposit({ from: node, value: '16'.ether });

            // Approve transfer & stake RPL twice
            await approveRPL(lqgNodeStaking.target, rplAmount, { from: node });
            await stakeRpl(rplAmount, {
                from: node,
            });
        });

        it(printTitle('random address', 'cannot stake RPL'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Approve transfer & attempt to stake RPL
            await approveRPL(lqgNodeStaking.target, rplAmount, { from: node });
            await shouldRevert(stakeRpl(rplAmount, {
                from: random,
            }), 'Random address staked RPL');
        });

        it(printTitle('node operator', 'can withdraw staked RPL'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Remove withdrawal cooldown period
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsRewards, 'rewards.claimsperiods', 0, { from: owner });

            // Stake RPL
            await nodeStakeRPL(rplAmount, { from: node });

            // Withdraw staked RPL
            await withdrawRpl(rplAmount, {
                from: node,
            });
        });

        it(printTitle('node operator', 'cannot withdraw staked RPL during the cooldown period'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Stake RPL
            await nodeStakeRPL(rplAmount, { from: node });

            // Withdraw staked RPL
            await shouldRevert(withdrawRpl(rplAmount, {
                from: node,
            }), 'Withdrew staked RPL during the cooldown period');
        });

        it(printTitle('node operator', 'cannot withdraw more RPL than they have staked'), async () => {
            // Set parameters
            const stakeAmount = '10000'.ether;
            const withdrawAmount = '20000'.ether;

            // Remove withdrawal cooldown period
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsRewards, 'rewards.claimsperiods', 0, { from: owner });

            // Stake RPL
            await nodeStakeRPL(stakeAmount, { from: node });

            // Withdraw staked RPL
            await shouldRevert(withdrawRpl(withdrawAmount, {
                from: node,
            }), 'Withdrew more RPL than was staked');
        });

        it(printTitle('node operator', 'cannot withdraw RPL leaving the node undercollateralised'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Remove withdrawal cooldown period
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsRewards, 'rewards.claimsperiods', 0, { from: owner });

            // Stake RPL
            await nodeStakeRPL(rplAmount, { from: node });

            // Make node deposit / create minipool
            await nodeDeposit({ from: node, value: '16'.ether });

            // Withdraw staked RPL
            await shouldRevert(withdrawRpl(rplAmount, {
                from: node,
            }), 'Withdrew RPL leaving the node undercollateralised');
        });

        it(printTitle('node operator', 'can withdraw RPL after finalising their minipool'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Remove withdrawal cooldown period
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsRewards, 'rewards.claimsperiods', 0, { from: owner });

            // Stake RPL
            await nodeStakeRPL(rplAmount, { from: node });

            // Create a staking minipool
            await userDeposit({ from: random, value: '16'.ether });
            const minipool = await createMinipool({ from: node, value: '16'.ether });
            await helpers.time.increase(scrubPeriod + 1);
            await stakeMinipool(minipool, { from: node });

            // Cannot withdraw RPL yet
            await shouldRevert(withdrawRpl(rplAmount, {
                from: node,
            }), 'Withdrew RPL leaving the node undercollateralised');

            // Still cannot withdraw RPL yet
            await shouldRevert(withdrawRpl(rplAmount, {
                from: node,
            }), 'Withdrew RPL leaving the node undercollateralised');

            // Withdraw and finalise
            await withdrawValidatorBalance(minipool, '32'.ether, node, true);

            // Should be able to withdraw now
            await withdrawRpl(rplAmount, {
                from: node,
            });
        });

        it(printTitle('node operator', 'cannot withdraw RPL if random distributes balance on their minipool until they finalise'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Remove withdrawal cooldown period
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsRewards, 'rewards.claimsperiods', 0, { from: owner });

            // Stake RPL
            await nodeStakeRPL(rplAmount, { from: node });

            // Create a staking minipool
            await userDeposit({ from: random, value: '16'.ether });
            const minipool = await createMinipool({ from: node, value: '16'.ether });
            await helpers.time.increase(scrubPeriod + 1);
            await stakeMinipool(minipool, { from: node });

            // Send ETH to the minipool to simulate receving from SWC
            await trustedNode.sendTransaction({
                to: minipool.target,
                value: '32'.ether,
            });

            // Begin user distribution process
            await beginUserDistribute(minipool, { from: random });
            // Wait
            await helpers.time.increase(userDistributeStartTime + 1);
            // Withdraw without finalising
            await withdrawValidatorBalance(minipool, '0'.ether, random);

            // Cannot withdraw RPL yet
            await shouldRevert(withdrawRpl(rplAmount, {
                from: node,
            }), 'Withdrew RPL leaving the node undercollateralised');

            // Finalise the pool
            await minipool.connect(node).finalise();

            // Should be able to withdraw now
            await withdrawRpl(rplAmount, {
                from: node,
            });
        });

        it(printTitle('random address', 'cannot withdraw staked RPL'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Remove withdrawal cooldown period
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsRewards, 'rewards.claimsperiods', 0, { from: owner });

            // Stake RPL
            await nodeStakeRPL(rplAmount, { from: node });

            // Withdraw staked RPL
            await shouldRevert(withdrawRpl(rplAmount, {
                from: random,
            }), 'Random address withdrew staked RPL');
        });

        it(printTitle('random address', 'cannot stake on behalf of a node without allowance'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Stake RPL
            await shouldRevert(nodeStakeRPLFor(node, rplAmount, { from: random }), 'Was able to stake', 'Not allowed to stake for');
        });

        it(printTitle('random address', 'can stake on behalf of a node with allowance'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Allow
            await setStakeRPLForAllowed(random, true, { from: node });

            // Stake RPL
            await nodeStakeRPLFor(node, rplAmount, { from: random });
        });

        it(printTitle('random address', 'can stake on behalf of a node with allowance from withdrawal address'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Set RPL withdrawal address
            await setNodeRPLWithdrawalAddress(node, rplWithdrawalAddress, { from: node });

            // Not allowed to set from node address any more
            await shouldRevert(setStakeRPLForAllowed(random, true, { from: node }), 'Was able to allow', 'Must be called from RPL withdrawal address');

            // Allow from RPL withdrawal address
            await setStakeRPLForAllowedWithNodeAddress(node, random, true, { from: rplWithdrawalAddress });

            // Stake RPL
            await nodeStakeRPLFor(node, rplAmount, { from: random });
        });

        it(printTitle('node operator', 'cannot stake from node address once RPL withdrawal address is set'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Set RPL withdrawal address
            await setNodeRPLWithdrawalAddress(node, rplWithdrawalAddress, { from: node });

            // Stake RPL
            await shouldRevert(nodeStakeRPL(rplAmount, { from: node }), 'Was able to stake', 'Not allowed to stake for');
        });

        it(printTitle('node operator', 'can stake from primary withdrawal address'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Set RPL withdrawal address
            await setNodeWithdrawalAddress(node, withdrawalAddress, { from: node });

            // Stake RPL
            await nodeStakeRPLFor(node, rplAmount, { from: withdrawalAddress });
        });

        it(printTitle('node operator', 'can stake from RPL withdrawal address'), async () => {
            // Set parameters
            const rplAmount = '10000'.ether;

            // Set RPL withdrawal address
            await setNodeRPLWithdrawalAddress(node, rplWithdrawalAddress, { from: node });

            // Stake RPL
            await nodeStakeRPLFor(node, rplAmount, { from: rplWithdrawalAddress });
        });
    });
}
