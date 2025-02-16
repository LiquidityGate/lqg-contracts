import { before, describe, it } from 'mocha';
import {
    artifacts,
    RevertOnTransfer,
    LQGDAONodeTrustedSettingsMinipool,
    LQGDAOProtocolSettingsMinipool,
    LQGDAOProtocolSettingsNetwork,
    LQGDAOProtocolSettingsNode,
    LQGDAOProtocolSettingsRewards,
    LQGMinipoolBase,
    LQGMinipoolBondReducer,
    LQGMinipoolDelegate,
    LQGMinipoolManager,
    LQGNodeManager,
    LQGTokenRPL,
    LQGVault,
} from '../_utils/artifacts';
import { printTitle } from '../_utils/formatting';
import { shouldRevert } from '../_utils/testing';
import { userDeposit } from '../_helpers/deposit';
import {
    createMinipool,
    dissolveMinipool,
    getMinipoolMinimumRPLStake,
    getNodeActiveMinipoolCount,
    minipoolStates,
    promoteMinipool,
    stakeMinipool,
} from '../_helpers/minipool';
import {
    getNodeAverageFee,
    nodeStakeRPL,
    registerNode,
    setNodeTrusted,
    setNodeWithdrawalAddress,
} from '../_helpers/node';
import { mintRPL } from '../_helpers/tokens';
import { close } from './scenario-close';
import { dissolve } from './scenario-dissolve';
import { refund } from './scenario-refund';
import { stake } from './scenario-stake';
import { beginUserDistribute, withdrawValidatorBalance } from './scenario-withdraw-validator-balance';
import { setDAOProtocolBootstrapSetting } from '../dao/scenario-dao-protocol-bootstrap';
import {
    setDAONodeTrustedBootstrapSetting,
    setDaoNodeTrustedBootstrapUpgrade,
} from '../dao/scenario-dao-node-trusted-bootstrap';
import { reduceBond } from './scenario-reduce-bond';
import { assertBN } from '../_helpers/bn';
import { skimRewards } from './scenario-skim-rewards';
import { globalSnapShot } from '../_utils/snapshotting';
import * as assert from 'assert';

const helpers = require('@nomicfoundation/hardhat-network-helpers');
const hre = require('hardhat');
const ethers = hre.ethers;

export default function() {
    describe('LQGMinipool', () => {
        let owner,
            node,
            emptyNode,
            nodeWithdrawalAddress,
            trustedNode,
            dummySwc,
            random;

        // Setup
        const secondsPerEpoch = 384;
        const launchTimeout = (60 * 60 * 72); // 72 hours
        const withdrawalDelay = 20;
        const scrubPeriod = (60 * 60 * 24); // 24 hours
        const bondReductionWindowStart = (2 * 24 * 60 * 60);
        const bondReductionWindowLength = (2 * 24 * 60 * 60);
        const rewardClaimBalanceIntervals = 28;
        const balanceSubmissionFrequency = (60 * 60 * 24);
        const rewardClaimPeriodTime = (rewardClaimBalanceIntervals * balanceSubmissionFrequency * secondsPerEpoch); // 28 days
        const userDistributeTime = (90 * 24 * 60 * 60); // 90 days
        const withdrawalBalance = '36'.ether;
        const lebDepositNodeAmount = '8'.ether;
        const halfDepositNodeAmount = '16'.ether;

        let newDelegateAddress = '0x0000000000000000000000000000000000000001';
        let initialisedMinipool;
        let prelaunchMinipool;
        let prelaunchMinipool2;
        let stakingMinipool;
        let dissolvedMinipool;
        let oldDelegateAddress;
        let lqgMinipoolBondReducer;

        before(async () => {
            await globalSnapShot();

            [
                owner,
                node,
                emptyNode,
                nodeWithdrawalAddress,
                trustedNode,
                dummySwc,
                random,
            ] = await ethers.getSigners();

            oldDelegateAddress = (await LQGMinipoolDelegate.deployed()).target;

            // Register node & set withdrawal address
            await registerNode({ from: node });
            await setNodeWithdrawalAddress(node, nodeWithdrawalAddress, { from: node });

            // Register empty node
            await registerNode({ from: emptyNode });

            // Register trusted node
            await registerNode({ from: trustedNode });
            await setNodeTrusted(trustedNode, 'saas_1', 'node@home.com', owner);

            // Set settings
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsMinipool, 'minipool.launch.timeout', launchTimeout, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsMinipool, 'minipool.withdrawal.delay', withdrawalDelay, { from: owner });
            await setDAONodeTrustedBootstrapSetting(LQGDAONodeTrustedSettingsMinipool, 'minipool.scrub.period', scrubPeriod, { from: owner });
            await setDAONodeTrustedBootstrapSetting(LQGDAONodeTrustedSettingsMinipool, 'minipool.bond.reduction.window.start', bondReductionWindowStart, { from: owner });
            await setDAONodeTrustedBootstrapSetting(LQGDAONodeTrustedSettingsMinipool, 'minipool.bond.reduction.window.length', bondReductionWindowLength, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.submit.balances.frequency', balanceSubmissionFrequency, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsRewards, 'rewards.claimsperiods', rewardClaimBalanceIntervals, { from: owner });

            // Set rETH collateralisation target to a value high enough it won't cause excess ETH to be funneled back into deposit pool and mess with our calcs
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.reth.collateral.target', '50'.ether, { from: owner });

            // Stake RPL to cover minipools
            let minipoolRplStake = await getMinipoolMinimumRPLStake();
            let rplStake = minipoolRplStake * 7n;
            await mintRPL(owner, node, rplStake);
            await nodeStakeRPL(rplStake, { from: node });

            // Create a dissolved minipool
            await userDeposit({ from: random, value: '16'.ether });
            dissolvedMinipool = await createMinipool({ from: node, value: '16'.ether });
            await helpers.time.increase(launchTimeout + 1);
            await dissolveMinipool(dissolvedMinipool, { from: node });

            // Create minipools
            await userDeposit({ from: random, value: '46'.ether });
            prelaunchMinipool = await createMinipool({ from: node, value: '16'.ether });
            prelaunchMinipool2 = await createMinipool({ from: node, value: '16'.ether });
            stakingMinipool = await createMinipool({ from: node, value: '16'.ether });
            initialisedMinipool = await createMinipool({ from: node, value: '16'.ether });

            // Wait required scrub period
            await helpers.time.increase(scrubPeriod + 1);

            // Progress minipools into desired statuses
            await stakeMinipool(stakingMinipool, { from: node });

            // Check minipool statuses
            let initialisedStatus = await initialisedMinipool.getStatus();
            let prelaunchStatus = await prelaunchMinipool.getStatus();
            let prelaunch2Status = await prelaunchMinipool2.getStatus();
            let stakingStatus = await stakingMinipool.getStatus();
            let dissolvedStatus = await dissolvedMinipool.getStatus();
            assertBN.equal(initialisedStatus, minipoolStates.Initialised, 'Incorrect initialised minipool status');
            assertBN.equal(prelaunchStatus, minipoolStates.Prelaunch, 'Incorrect prelaunch minipool status');
            assertBN.equal(prelaunch2Status, minipoolStates.Prelaunch, 'Incorrect prelaunch minipool status');
            assertBN.equal(stakingStatus, minipoolStates.Staking, 'Incorrect staking minipool status');
            assertBN.equal(dissolvedStatus, minipoolStates.Dissolved, 'Incorrect dissolved minipool status');

            lqgMinipoolBondReducer = await LQGMinipoolBondReducer.deployed();
        });

        async function upgradeNetworkDelegateContract() {
            // Upgrade the delegate contract
            await setDaoNodeTrustedBootstrapUpgrade('upgradeContract', 'lqgMinipoolDelegate', [], newDelegateAddress, {
                from: owner,
            });

            // Check effective delegate is still the original
            const minipool = await LQGMinipoolBase.at(stakingMinipool.target);
            const effectiveDelegate = await minipool.getEffectiveDelegate();
            assert.notEqual(effectiveDelegate, newDelegateAddress, 'Effective delegate was updated');
        }

        async function resetNetworkDelegateContract() {
            // Upgrade the delegate contract
            await setDaoNodeTrustedBootstrapUpgrade('upgradeContract', 'lqgMinipoolDelegate', [], oldDelegateAddress, {
                from: owner,
            });
        }

        //
        // General
        //

        it(printTitle('random address', 'cannot send ETH to non-payable minipool delegate methods'), async () => {
            // Attempt to send ETH to view method
            await shouldRevert(prelaunchMinipool.getStatus({
                from: random,
                value: '1'.ether,
            }), 'Sent ETH to a non-payable minipool delegate view method');

            // Attempt to send ETH to mutator method
            await shouldRevert(refund(prelaunchMinipool, {
                from: node,
                value: '1'.ether,
            }), 'Sent ETH to a non-payable minipool delegate mutator method');
        });

        it(printTitle('minipool', 'has correct withdrawal credentials'), async () => {
            // Get contracts
            const lqgMinipoolManager = await LQGMinipoolManager.deployed();

            // Withdrawal credentials settings
            const withdrawalPrefix = '01';
            const padding = '0000000000000000000000';

            // Get minipool withdrawal credentials
            let withdrawalCredentials = await lqgMinipoolManager.getMinipoolWithdrawalCredentials(initialisedMinipool.target);

            // Check withdrawal credentials
            let expectedWithdrawalCredentials = ('0x' + withdrawalPrefix + padding + initialisedMinipool.target.substr(2));
            assert.equal(withdrawalCredentials.toLowerCase(), expectedWithdrawalCredentials.toLowerCase(), 'Invalid minipool withdrawal credentials');
        });

        it(printTitle('node operator', 'cannot create a minipool if network capacity is reached and destroying a minipool reduces the capacity'), async () => {
            // Retrieve the current number of minipools
            const lqgMinipoolManager = await LQGMinipoolManager.deployed();
            const minipoolCount = Number(await lqgMinipoolManager.getMinipoolCount());
            // Set max to the current number
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsMinipool, 'minipool.maximum.count', minipoolCount, { from: owner });
            // Creating minipool should fail now
            await shouldRevert(createMinipool({
                from: node,
                value: '16'.ether,
            }), 'Was able to create a minipool when capacity is reached', 'Global minipool limit reached');
            // Destroy a pool
            await withdrawValidatorBalance(stakingMinipool, withdrawalBalance, nodeWithdrawalAddress, true);
            // Creating minipool should no longer fail
            await createMinipool({ from: node, value: '16'.ether });
        });

        it(printTitle('node operator', 'cannot create a minipool if delegate address is set to a non-contract'), async () => {
            // Upgrade network delegate contract to random address
            await upgradeNetworkDelegateContract();
            // Creating minipool should fail now
            await shouldRevert(createMinipool({
                from: node,
                value: '16'.ether,
            }), 'Was able to create a minipool with bad delegate address', 'Delegate contract does not exist');
        });

        it(printTitle('node operator', 'cannot delegatecall to a delgate address that is a non-contract'), async () => {
            // Creating minipool should fail now
            let newMinipool = await createMinipool({ from: node, value: '16'.ether });
            const newMinipoolBase = await LQGMinipoolBase.at(newMinipool.target);
            // Upgrade network delegate contract to random address
            await upgradeNetworkDelegateContract();
            // Call upgrade delegate
            await newMinipoolBase.connect(node).setUseLatestDelegate(true, { from: node });
            // Staking should fail now
            await shouldRevert(stakeMinipool(newMinipool, { from: node }), 'Was able to create a minipool with bad delegate address', 'Delegate contract does not exist');

            // Reset the delegate to working contract to prevent invariant tests from failing
            await resetNetworkDelegateContract();
        });

        //
        // Finalise
        //

        it(printTitle('node operator', 'can finalise a user withdrawn minipool'), async () => {
            // Send enough ETH to allow distribution
            await owner.sendTransaction({
                to: stakingMinipool.target,
                value: withdrawalBalance,
            });
            // Begin user distribution process
            await beginUserDistribute(stakingMinipool, { from: random });
            // Wait 14 days
            await helpers.time.increase(userDistributeTime + 1);
            // Withdraw without finalising
            await withdrawValidatorBalance(stakingMinipool, withdrawalBalance, random);
            // Get number of active minipools before
            const count1 = await getNodeActiveMinipoolCount(node);
            // Finalise
            await stakingMinipool.connect(nodeWithdrawalAddress).finalise({ from: nodeWithdrawalAddress });
            // Get number of active minipools after
            const count2 = await getNodeActiveMinipoolCount(node);
            // Make sure active minipool count reduced by one
            assertBN.equal(count1 - count2, 1, 'Active minipools did not decrement by 1');
        });

        it(printTitle('node operator', 'cannot finalise a withdrawn minipool twice'), async () => {
            // Send enough ETH to allow distribution
            await owner.sendTransaction({
                to: stakingMinipool.target,
                value: withdrawalBalance,
            });
            // Begin user distribution process
            await beginUserDistribute(stakingMinipool, { from: random });
            // Wait 14 days
            await helpers.time.increase(userDistributeTime + 1);
            // Withdraw without finalising
            await withdrawValidatorBalance(stakingMinipool, withdrawalBalance, random);
            // Finalise
            await stakingMinipool.connect(nodeWithdrawalAddress).finalise({ from: nodeWithdrawalAddress });
            // Second time should fail
            await shouldRevert(stakingMinipool.connect(nodeWithdrawalAddress).finalise({ from: nodeWithdrawalAddress }), 'Was able to finalise pool twice', 'Minipool has already been finalised');
        });

        it(printTitle('node operator', 'cannot finalise a non-withdrawn minipool'), async () => {
            // Finalise
            await shouldRevert(stakingMinipool.connect(nodeWithdrawalAddress).finalise({ from: nodeWithdrawalAddress }), 'Minipool was finalised before withdrawn', 'Can only manually finalise after user distribution');
        });

        it(printTitle('random address', 'cannot finalise a withdrawn minipool'), async () => {
            // Withdraw without finalising
            await withdrawValidatorBalance(stakingMinipool, withdrawalBalance, nodeWithdrawalAddress);
            // Finalise
            await shouldRevert(stakingMinipool.connect(random).finalise({ from: random }), 'Minipool was finalised by random', 'Invalid minipool owner');
        });

        //
        // Slash
        //

        it(printTitle('random address', 'can slash node operator if withdrawal balance is less than 16 ETH'), async () => {
            // Stake the prelaunch minipool (it has 16 ETH user funds)
            await stakeMinipool(prelaunchMinipool, { from: node });
            // Send enough ETH to allow distribution
            await owner.sendTransaction({
                to: prelaunchMinipool.target,
                value: '8'.ether,
            });
            // Begin user distribution process
            await beginUserDistribute(prelaunchMinipool, { from: random });
            // Wait 14 days
            await helpers.time.increase(userDistributeTime + 1);
            // Post an 8 ETH balance which should result in 8 ETH worth of RPL slashing
            await withdrawValidatorBalance(prelaunchMinipool, '0'.ether, random);
            // Call slash method
            await prelaunchMinipool.connect(random).slash({ from: random });
            // Check slashed flag
            const slashed = await (await LQGMinipoolManager.deployed()).getMinipoolRPLSlashed(prelaunchMinipool.target);
            assert.equal(slashed, true, 'Slashed flag not set');
            // Auction house should now have slashed 8 ETH worth of RPL (which is 800 RPL at starting price)
            const lqgVault = await LQGVault.deployed();
            const lqgTokenRPL = await LQGTokenRPL.deployed();
            const balance = await lqgVault.balanceOfToken('lqgAuctionManager', lqgTokenRPL.target);
            assertBN.equal(balance, '800'.ether);
        });

        it(printTitle('node operator', 'is slashed if withdraw is processed when balance is less than 16 ETH'), async () => {
            // Stake the prelaunch minipool (it has 16 ETH user funds)
            await stakeMinipool(prelaunchMinipool, { from: node });
            // Post an 8 ETH balance which should result in 8 ETH worth of RPL slashing
            await withdrawValidatorBalance(prelaunchMinipool, '8'.ether, nodeWithdrawalAddress, true);
            // Check slashed flag
            const slashed = await (await LQGMinipoolManager.deployed()).getMinipoolRPLSlashed(prelaunchMinipool.target);
            assert.equal(slashed, true, 'Slashed flag not set');
            // Auction house should now have slashed 8 ETH worth of RPL (which is 800 RPL at starting price)
            const lqgVault = await LQGVault.deployed();
            const lqgTokenRPL = await LQGTokenRPL.deployed();
            const balance = await lqgVault.balanceOfToken('lqgAuctionManager', lqgTokenRPL.target);
            assertBN.equal(balance, '800'.ether);
        });

        //
        // Dissolve
        //

        it(printTitle('node operator', 'cannot dissolve their own staking minipools'), async () => {
            // Attempt to dissolve staking minipool
            await shouldRevert(dissolve(stakingMinipool, {
                from: node,
            }), 'Dissolved a staking minipool');
        });

        it(printTitle('random address', 'can dissolve a timed out minipool at prelaunch'), async () => {
            // Time prelaunch minipool out
            await helpers.time.increase(launchTimeout);

            // Dissolve prelaunch minipool
            await dissolve(prelaunchMinipool, {
                from: random,
            });
        });

        it(printTitle('random address', 'cannot dissolve a minipool which is not at prelaunch'), async () => {
            // Time prelaunch minipool out
            await helpers.time.increase(launchTimeout);

            // Attempt to dissolve initialised minipool
            await shouldRevert(dissolve(initialisedMinipool, {
                from: random,
            }), 'Random address dissolved a minipool which was not at prelaunch');
        });

        it(printTitle('random address', 'cannot dissolve a minipool which has not timed out'), async () => {
            // Attempt to dissolve prelaunch minipool
            await shouldRevert(dissolve(prelaunchMinipool, {
                from: random,
            }), 'Random address dissolved a minipool which has not timed out');
        });

        //
        // Stake
        //

        it(printTitle('node operator', 'can stake a minipool at prelaunch'), async () => {
            // Stake prelaunch minipool
            await stake(prelaunchMinipool, null, {
                from: node,
            });
        });

        it(printTitle('node operator', 'cannot stake a minipool which is not at prelaunch'), async () => {
            // Attempt to stake initialised minipool
            await shouldRevert(stake(initialisedMinipool, null, {
                from: node,
            }), 'Staked a minipool which was not at prelaunch');
        });

        it(printTitle('node operator', 'cannot stake a minipool with a reused validator pubkey'), async () => {
            // Load contracts
            const lqgMinipoolManager = await LQGMinipoolManager.deployed();

            // Get minipool validator pubkey
            const validatorPubkey = await lqgMinipoolManager.getMinipoolPubkey(prelaunchMinipool.target);

            // Stake prelaunch minipool
            await stake(prelaunchMinipool, null, { from: node });

            // Attempt to stake second prelaunch minipool with same pubkey
            await shouldRevert(stake(prelaunchMinipool2, null, {
                from: node,
            }, validatorPubkey), 'Staked a minipool with a reused validator pubkey');
        });

        it(printTitle('node operator', 'cannot stake a minipool with incorrect withdrawal credentials'), async () => {
            // Get withdrawal credentials
            let invalidWithdrawalCredentials = '0x1111111111111111111111111111111111111111111111111111111111111111';

            // Attempt to stake prelaunch minipool
            await shouldRevert(stake(prelaunchMinipool, invalidWithdrawalCredentials, {
                from: node,
            }), 'Staked a minipool with incorrect withdrawal credentials');
        });

        it(printTitle('random address', 'cannot stake a minipool'), async () => {
            // Attempt to stake prelaunch minipool
            await shouldRevert(stake(prelaunchMinipool, null, {
                from: random,
            }), 'Random address staked a minipool');
        });

        //
        // Withdraw validator balance
        //

        it(printTitle('random', 'random address cannot withdraw and destroy a node operators minipool balance'), async () => {
            // Wait 14 days
            await helpers.time.increase(60 * 60 * 24 * 14 + 1);
            // Attempt to send validator balance
            await shouldRevert(withdrawValidatorBalance(stakingMinipool, withdrawalBalance, random, true), 'Random address withdrew validator balance from a node operators minipool', 'Only owner can distribute right now');
        });

        it(printTitle('random', 'random address can trigger a payout of withdrawal balance if balance is greater than 16 ETH'), async () => {
            // Send enough ETH to allow distribution
            await owner.sendTransaction({
                to: stakingMinipool.target,
                value: '32'.ether,
            });
            // Begin user distribution process
            await beginUserDistribute(stakingMinipool, { from: random });
            // Wait 14 days
            await helpers.time.increase(userDistributeTime + 1);
            // Post an 8 ETH balance which should result in 8 ETH worth of RPL slashing
            await withdrawValidatorBalance(stakingMinipool, '0'.ether, random);
        });

        it(printTitle('random', 'random address cannot trigger a payout of withdrawal balance if balance is less than 16 ETH'), async () => {
            // Attempt to send validator balance
            await shouldRevert(withdrawValidatorBalance(stakingMinipool, '15'.ether, random, false), 'Random address was able to execute withdraw on sub 16 ETH minipool', 'Only owner can distribute right now');
        });

        it(printTitle('node operator withdrawal address', 'can withdraw their ETH once it is received, then distribute ETH to the rETH contract / deposit pool and destroy the minipool'), async () => {
            // Send validator balance and withdraw
            await withdrawValidatorBalance(stakingMinipool, withdrawalBalance, nodeWithdrawalAddress, true);
        });

        it(printTitle('node operator account', 'can also withdraw their ETH once it is received, then distribute ETH to the rETH contract / deposit pool and destroy the minipool'), async () => {
            // Send validator balance and withdraw
            await withdrawValidatorBalance(stakingMinipool, withdrawalBalance, node, true);
        });

        it(printTitle('malicious node operator', 'can not prevent a payout by using a reverting contract as withdraw address'), async () => {
            // Set the node's withdraw address to a reverting contract
            const revertOnTransfer = await RevertOnTransfer.deployed();
            await setNodeWithdrawalAddress(node, revertOnTransfer.target, { from: nodeWithdrawalAddress });
            // Wait 14 days
            await helpers.time.increase(60 * 60 * 24 * 14 + 1);
            // Send enough ETH to allow distribution
            await owner.sendTransaction({
                to: stakingMinipool.target,
                value: withdrawalBalance,
            });
            // Begin user distribution process
            await beginUserDistribute(stakingMinipool, { from: random });
            // Wait 14 days
            await helpers.time.increase(userDistributeTime + 1);
            // Post an 8 ETH balance which should result in 8 ETH worth of RPL slashing
            await withdrawValidatorBalance(stakingMinipool, '0'.ether, random);
        });

        it(printTitle('random address', 'can send validator balance to a withdrawable minipool in one transaction'), async () => {
            await random.sendTransaction({
                to: stakingMinipool.target,
                value: withdrawalBalance,
            });

            // Begin user distribution process
            await beginUserDistribute(stakingMinipool, { from: random });
            // Wait 14 days
            await helpers.time.increase(userDistributeTime + 1);
            // Post an 8 ETH balance which should result in 8 ETH worth of RPL slashing
            await withdrawValidatorBalance(stakingMinipool, '0'.ether, random);
        });

        it(printTitle('random address', 'can send validator balance to a withdrawable minipool across multiple transactions'), async () => {
            // Get tx amount (half of withdrawal balance)
            let amount1 = withdrawalBalance / 2n;
            let amount2 = withdrawalBalance - amount1;

            await random.sendTransaction({
                to: stakingMinipool.target,
                value: amount1,
            });

            await owner.sendTransaction({
                to: stakingMinipool.target,
                value: amount2,
            });

            // Begin user distribution process
            await beginUserDistribute(stakingMinipool, { from: random });
            // Wait 14 days
            await helpers.time.increase(userDistributeTime + 1);
            // Post an 8 ETH balance which should result in 8 ETH worth of RPL slashing
            await withdrawValidatorBalance(stakingMinipool, '0'.ether, random);
        });

        //
        // Skim rewards
        //

        it(printTitle('node operator', 'can skim rewards less than 8 ETH'), async () => {
            // Send 1 ETH to the minipool
            await owner.sendTransaction({
                to: stakingMinipool.target,
                value: '1'.ether,
            });
            // Skim rewards from node
            await skimRewards(stakingMinipool, { from: node });
        });

        it(printTitle('random user', 'can skim rewards less than 8 ETH'), async () => {
            // Send 1 ETH to the minipool
            await owner.sendTransaction({
                to: stakingMinipool.target,
                value: '1'.ether,
            });
            // Skim rewards from node
            await skimRewards(stakingMinipool, { from: random });
        });

        it(printTitle('random user', 'can skim rewards less than 8 ETH twice'), async () => {
            // Send 1 ETH to the minipool
            await owner.sendTransaction({
                to: stakingMinipool.target,
                value: '1'.ether,
            });
            // Skim rewards from random
            await skimRewards(stakingMinipool, { from: random });
            // Send 1 ETH to the minipool
            await owner.sendTransaction({
                to: stakingMinipool.target,
                value: '1'.ether,
            });
            // Skim rewards from random
            await skimRewards(stakingMinipool, { from: random });
        });

        it(printTitle('random user + node operator', 'can skim rewards less than 8 ETH twice interchangeably'), async () => {
            // Send 1 ETH to the minipool
            await owner.sendTransaction({
                to: stakingMinipool.target,
                value: '1.5'.ether,
            });
            // Skim rewards from random
            await skimRewards(stakingMinipool, { from: random });
            // Send 1 ETH to the minipool
            await owner.sendTransaction({
                to: stakingMinipool.target,
                value: '2'.ether,
            });
            // Skim rewards from node
            await skimRewards(stakingMinipool, { from: node });
        });

        //
        // Close
        //

        it(printTitle('node operator', 'can close a dissolved minipool'), async () => {
            // Send 16 ETH to minipool
            await random.sendTransaction({
                to: dissolvedMinipool.target,
                value: '16'.ether,
            });

            // Close dissolved minipool
            await close(dissolvedMinipool, {
                from: node,
            });
        });

        it(printTitle('node operator', 'cannot close a minipool which is not dissolved'), async () => {
            // Attempt to close staking minipool
            await shouldRevert(close(stakingMinipool, {
                from: node,
            }), 'Closed a minipool which was not dissolved', 'The minipool can only be closed while dissolved');
        });

        it(printTitle('random address', 'cannot close a dissolved minipool'), async () => {
            // Attempt to close dissolved minipool
            await shouldRevert(close(dissolvedMinipool, {
                from: random,
            }), 'Random address closed a minipool', 'Invalid minipool owner');
        });

        //
        // Delegate upgrades
        //

        it(printTitle('node operator', 'can upgrade and rollback their delegate contract'), async () => {
            await upgradeNetworkDelegateContract();
            // Get contract
            const minipool = await LQGMinipoolBase.at(stakingMinipool.target);
            // Store original delegate
            let originalDelegate = await minipool.getEffectiveDelegate();
            // Call upgrade delegate
            await minipool.connect(node).delegateUpgrade({ from: node });
            // Check delegate settings
            let effectiveDelegate = await minipool.getEffectiveDelegate();
            let previousDelegate = await minipool.getPreviousDelegate();
            assert.strictEqual(effectiveDelegate, newDelegateAddress, 'Effective delegate was not updated');
            assert.strictEqual(previousDelegate, originalDelegate, 'Previous delegate was not updated');
            // Call upgrade rollback
            await minipool.connect(node).delegateRollback({ from: node });
            // Check effective delegate
            effectiveDelegate = await minipool.getEffectiveDelegate();
            assert.strictEqual(effectiveDelegate, originalDelegate, 'Effective delegate was not rolled back');
        });

        it(printTitle('node operator', 'can use latest delegate contract'), async () => {
            await upgradeNetworkDelegateContract();
            // Get contract
            const minipool = await LQGMinipoolBase.at(stakingMinipool.target);
            // Store original delegate
            let originalDelegate = await minipool.getEffectiveDelegate();
            // Call upgrade delegate
            await minipool.connect(node).setUseLatestDelegate(true, { from: node });
            let useLatest = await minipool.getUseLatestDelegate();
            assert.equal(useLatest, true, 'Use latest flag was not set');
            // Check delegate settings
            let effectiveDelegate = await minipool.getEffectiveDelegate();
            let currentDelegate = await minipool.getDelegate();
            assert.strictEqual(effectiveDelegate, newDelegateAddress, 'Effective delegate was not updated');
            assert.strictEqual(currentDelegate, originalDelegate, 'Current delegate was updated');
            // Upgrade the delegate contract again
            newDelegateAddress = '0x0000000000000000000000000000000000000002';
            await setDaoNodeTrustedBootstrapUpgrade('upgradeContract', 'lqgMinipoolDelegate', [], newDelegateAddress, {
                from: owner,
            });
            // Check effective delegate
            effectiveDelegate = await minipool.getEffectiveDelegate();
            assert.strictEqual(effectiveDelegate, newDelegateAddress, 'Effective delegate was not updated');
            // Reset the delegate to working contract to prevent invariant tests from failing
            await resetNetworkDelegateContract();
        });

        it(printTitle('random', 'cannot upgrade, rollback or set use latest delegate contract'), async () => {
            await upgradeNetworkDelegateContract();
            // Get contract
            const minipool = await LQGMinipoolBase.at(stakingMinipool.target);
            // Call upgrade delegate from random
            await shouldRevert(minipool.connect(random).delegateUpgrade({ from: random }), 'Random was able to upgrade delegate', 'Only the node operator can access this method');
            // Call upgrade delegate from node
            await minipool.connect(node).delegateUpgrade({ from: node });
            // Call upgrade rollback from random
            await shouldRevert(minipool.connect(random).delegateRollback({ from: random }), 'Random was able to rollback delegate', 'Only the node operator can access this method');
            // Call set use latest from random
            await shouldRevert(minipool.connect(random).setUseLatestDelegate(true, { from: random }), 'Random was able to set use latest delegate', 'Only the node operator can access this method');
            // Reset the delegate to working contract to prevent invariant tests from failing
            await resetNetworkDelegateContract();
            await minipool.connect(node).delegateUpgrade({ from: node });
        });

        //
        // Reducing bond amount
        //

        it(printTitle('node operator', 'can reduce bond amount to a valid deposit amount'), async () => {
            // Get contracts
            // Signal wanting to reduce
            await lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(stakingMinipool.target, '8'.ether, { from: node });
            await helpers.time.increase(bondReductionWindowStart + 1);
            // Reduction from 16 ETH to 8 ETH should be valid
            await reduceBond(stakingMinipool, { from: node });
        });

        it(printTitle('node operator', 'average node fee gets updated correctly on bond reduction'), async () => {
            // Get contracts
            const lqgNodeManager = await LQGNodeManager.deployed();
            // Set the network node fee to 20%
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.minimum', '0.20'.ether, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.target', '0.20'.ether, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.maximum', '0.20'.ether, { from: owner });
            // Stake RPL to cover a 16 ETH and an 8 ETH minipool (1.6 + 2.4)
            let rplStake = '400'.ether;
            await mintRPL(owner, emptyNode, rplStake);
            await nodeStakeRPL(rplStake, { from: emptyNode });
            // Deposit enough user funds to cover minipool creation
            await userDeposit({ from: random, value: '64'.ether });
            // Create the minipools
            let minipool1 = await createMinipool({ from: emptyNode, value: '16'.ether });
            let minipool2 = await createMinipool({ from: emptyNode, value: '16'.ether });
            // Wait required scrub period
            await helpers.time.increase(scrubPeriod + 1);
            // Progress minipools into desired statuses
            await stakeMinipool(minipool1, { from: emptyNode });
            await stakeMinipool(minipool2, { from: emptyNode });
            // Set the network node fee to 10%
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.minimum', '0.10'.ether, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.target', '0.10'.ether, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.maximum', '0.10'.ether, { from: owner });
            // Signal wanting to reduce
            await lqgMinipoolBondReducer.connect(emptyNode).beginReduceBondAmount(minipool1.target, '8'.ether, { from: emptyNode });
            await helpers.time.increase(bondReductionWindowStart + 1);
            // Reduction from 16 ETH to 8 ETH should be valid
            let fee1 = await lqgNodeManager.getAverageNodeFee(emptyNode);
            await reduceBond(minipool1, { from: emptyNode });
            let fee2 = await lqgNodeManager.getAverageNodeFee(emptyNode);
            /*
                Node operator now has 1x 16 ETH bonded minipool at 20% node fee and 1x 8 ETH bonded minipool at 10% fee
                Before bond reduction average node fee should be 20%, weighted average node fee after should be 14%
             */
            assertBN.equal(fee1, '0.20'.ether, 'Incorrect node fee');
            assertBN.equal(fee2, '0.14'.ether, 'Incorrect node fee');
        });

        it(printTitle('node operator', 'can reduce bond amount to a valid deposit amount after reward period'), async () => {
            // Upgrade LQGNodeDeposit to add 4 ETH LEB support
            const LQGNodeDepositLEB4 = artifacts.require('LQGNodeDepositLEB4');
            const lqgNodeDepositLEB4 = await LQGNodeDepositLEB4.deployed();
            await setDaoNodeTrustedBootstrapUpgrade('upgradeContract', 'lqgNodeDeposit', LQGNodeDepositLEB4.abi, lqgNodeDepositLEB4.target, { from: owner });

            // Signal wanting to reduce
            await lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(stakingMinipool.target, '8'.ether, { from: node });
            await helpers.time.increase(bondReductionWindowStart + 1);
            // Reduction from 16 ETH to 8 ETH should be valid
            await reduceBond(stakingMinipool, { from: node });

            // Increase
            await helpers.time.increase(rewardClaimPeriodTime + 1);

            // Signal wanting to reduce again
            await lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(stakingMinipool.target, '4'.ether, { from: node });
            await helpers.time.increase(bondReductionWindowStart + 1);
            // Reduction from 16 ETH to 8 ETH should be valid
            await reduceBond(stakingMinipool, { from: node });
        });

        it(printTitle('node operator', 'can not reduce bond amount to a valid deposit amount within reward period'), async () => {
            // Upgrade LQGNodeDeposit to add 4 ETH LEB support
            const LQGNodeDepositLEB4 = artifacts.require('LQGNodeDepositLEB4');
            const lqgNodeDepositLEB4 = await LQGNodeDepositLEB4.deployed();
            await setDaoNodeTrustedBootstrapUpgrade('upgradeContract', 'lqgNodeDeposit', LQGNodeDepositLEB4.abi, lqgNodeDepositLEB4.target, { from: owner });

            // Signal wanting to reduce
            await lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(stakingMinipool.target, '8'.ether, { from: node });
            await helpers.time.increase(bondReductionWindowStart + 1);
            // Reduction from 16 ETH to 8 ETH should be valid
            await reduceBond(stakingMinipool, { from: node });

            // Signal wanting to reduce again
            await shouldRevert(lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(stakingMinipool.target, '4'.ether, { from: node }), 'Was able to reduce without waiting', 'Not enough time has passed since last bond reduction');
        });

        it(printTitle('node operator', 'cannot reduce bond without waiting'), async () => {
            // Signal wanting to reduce and wait 7 days
            await lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(stakingMinipool.target, '8'.ether, { from: node });
            // Reduction from 16 ETH to 8 ETH should be valid
            await shouldRevert(reduceBond(stakingMinipool, { from: node }), 'Was able to reduce bond without waiting', 'Wait period not satisfied');
        });

        it(printTitle('node operator', 'cannot begin to reduce bond after odao has cancelled'), async () => {
            // Vote to cancel
            await lqgMinipoolBondReducer.connect(trustedNode).voteCancelReduction(stakingMinipool.target, { from: trustedNode });
            // Signal wanting to reduce and wait 7 days
            await shouldRevert(lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(stakingMinipool.target, '8'.ether, { from: node }), 'Was able to begin to reduce bond', 'This minipool is not allowed to reduce bond');
        });

        it(printTitle('node operator', 'cannot reduce bond after odao has cancelled'), async () => {
            // Signal wanting to reduce and wait 7 days
            await lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(stakingMinipool.target, '8'.ether, { from: node });
            await helpers.time.increase(bondReductionWindowStart + 1);
            // Vote to cancel
            await lqgMinipoolBondReducer.connect(trustedNode).voteCancelReduction(stakingMinipool.target, { from: trustedNode });
            // Wait and try to reduce
            await shouldRevert(reduceBond(stakingMinipool, { from: node }), 'Was able to reduce bond after it was cancelled', 'This minipool is not allowed to reduce bond');
        });

        it(printTitle('node operator', 'cannot reduce bond if wait period exceeds the limit'), async () => {
            // Signal wanting to reduce and wait 7 days
            await lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(stakingMinipool.target, '8'.ether, { from: node });
            await helpers.time.increase(bondReductionWindowStart + bondReductionWindowLength + 1);
            // Reduction from 16 ETH to 8 ETH should be valid
            await shouldRevert(reduceBond(stakingMinipool, { from: node }), 'Was able to reduce bond without waiting', 'Wait period not satisfied');
        });

        it(printTitle('node operator', 'cannot reduce bond without beginning the process first'), async () => {
            // Reduction from 16 ETH to 8 ETH should be valid
            await shouldRevert(reduceBond(stakingMinipool, { from: node }), 'Was able to reduce bond without beginning the process', 'Wait period not satisfied');
        });

        it(printTitle('node operator', 'cannot reduce bond amount to an invalid deposit amount'), async () => {
            // Reduce to 9 ether bond should fail
            await shouldRevert(lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(stakingMinipool.target, '9'.ether, { from: node }), 'Was able to reduce to invalid bond', 'Invalid bond amount');
        });

        it(printTitle('node operator', 'cannot increase bond amount'), async () => {
            // Signal wanting to reduce and wait 7 days
            await shouldRevert(lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(stakingMinipool.target, '18'.ether, { from: node }), 'Was able to increase bond', 'Invalid bond amount');
        });

        it(printTitle('node operator', 'cannot reduce bond amount while in invalid state'), async () => {
            // Signal wanting to reduce and wait 7 days
            await shouldRevert(lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(prelaunchMinipool.target, '8'.ether, { from: node }), 'Was able to begin reducing bond on a prelaunch minipool', 'Minipool must be staking');
            await shouldRevert(lqgMinipoolBondReducer.connect(node).beginReduceBondAmount(initialisedMinipool.target, '8'.ether, { from: node }), 'Was able to reduce bond on an initialised minipool', 'Minipool must be staking');
            await helpers.time.increase(bondReductionWindowStart + 1);
        });

        //
        // Zero min stake
        //

        it(printTitle('node operator', 'can create minipools when minimum stake is set to zero'), async () => {
            // Set min stake to 0
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNode, 'node.per.minipool.stake.minimum', 0, { from: owner });
            // Create multiple minipools from a new node with 0 RPL staked
            for (let i = 0; i < 5; i++) {
                await createMinipool({ from: emptyNode, value: '8'.ether });
            }
        });

        //
        // Misc checks
        //

        it(printTitle('node operator', 'cannot promote a non-vacant minipool'), async () => {
            // Try to promote (and fail)
            await shouldRevert(promoteMinipool(prelaunchMinipool, { from: node }), 'Was able to promote non-vacant minipool', 'Cannot promote a non-vacant minipool');
            await shouldRevert(promoteMinipool(stakingMinipool, { from: node }), 'Was able to promote non-vacant minipool', 'The minipool can only promote while in prelaunch');
            await shouldRevert(promoteMinipool(initialisedMinipool, { from: node }), 'Was able to promote non-vacant minipool', 'The minipool can only promote while in prelaunch');
            await shouldRevert(promoteMinipool(dissolvedMinipool, { from: node }), 'Was able to promote non-vacant minipool', 'The minipool can only promote while in prelaunch');
        });

        const average_fee_tests = [
            [
                {
                    fee: '0.10',
                    amount: lebDepositNodeAmount,
                    expectedFee: '0.10',
                },
                {
                    fee: '0.10',
                    amount: lebDepositNodeAmount,
                    expectedFee: '0.10',
                },
                {
                    fee: '0.10',
                    amount: halfDepositNodeAmount,
                    expectedFee: '0.10',
                },
            ],
            [
                {
                    fee: '0.10',
                    amount: halfDepositNodeAmount,
                    expectedFee: '0.10',
                },
                {
                    fee: '0.20',
                    amount: lebDepositNodeAmount,
                    expectedFee: '0.16',
                },
                {
                    fee: '0.20',
                    amount: lebDepositNodeAmount,
                    expectedFee: '0.175',
                },
            ],
        ];

        for (let i = 0; i < average_fee_tests.length; i++) {
            let test = average_fee_tests[i];

            it(printTitle('node operator', 'has correct average node fee #' + (i + 1)), async () => {

                async function setNetworkNodeFee(fee) {
                    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.minimum', fee, { from: owner });
                    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.target', fee, { from: owner });
                    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.maximum', fee, { from: owner });
                }

                // Stake RPL to cover minipools
                let minipoolRplStake = await getMinipoolMinimumRPLStake();
                let rplStake = minipoolRplStake * 10n;
                await mintRPL(owner, emptyNode, rplStake);
                await nodeStakeRPL(rplStake, { from: emptyNode });

                for (const step of test) {
                    // Set fee to 10%
                    await setNetworkNodeFee(step.fee.ether);

                    // Deposit
                    let minipool = await createMinipool({ from: emptyNode, value: step.amount });
                    await userDeposit({ from: random, value: '32'.ether });

                    // Wait required scrub period
                    await helpers.time.increase(scrubPeriod + 1);

                    // Progress minipools into desired statuses
                    await stakeMinipool(minipool, { from: emptyNode });

                    // Get average
                    let average = await getNodeAverageFee(emptyNode);
                    assertBN.equal(average, step.expectedFee.ether, 'Invalid average fee');
                }
            });
        }
    });
}
