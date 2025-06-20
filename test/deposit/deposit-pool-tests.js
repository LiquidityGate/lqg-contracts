import { before, describe, it } from 'mocha';
import { printTitle } from '../_utils/formatting';
import { shouldRevert } from '../_utils/testing';
import { userDeposit } from '../_helpers/deposit';
import { createMinipool, getMinipoolMinimumRPLStake } from '../_helpers/minipool';
import { submitBalances } from '../_helpers/network';
import { nodeDeposit, nodeStakeRPL, registerNode, setNodeTrusted } from '../_helpers/node';
import { getRethExchangeRate, getRethTotalSupply, mintRPL } from '../_helpers/tokens';
import { getDepositSetting } from '../_helpers/settings';
import { deposit } from './scenario-deposit';
import {
    LQGDAONodeTrustedSettingsMembers,
    LQGDAOProtocolSettingsDeposit,
    LQGDepositPool,
} from '../_utils/artifacts';
import { setDAOProtocolBootstrapSetting } from '../dao/scenario-dao-protocol-bootstrap';
import { setDAONodeTrustedBootstrapSetting } from '../dao/scenario-dao-node-trusted-bootstrap';
import { assignDepositsV2 } from './scenario-assign-deposits-v2';
import { assertBN } from '../_helpers/bn';
import { globalSnapShot } from '../_utils/snapshotting';

const hre = require('hardhat');
const ethers = hre.ethers;

export default function() {
    describe('LQGDepositPool', () => {
        let owner,
            node,
            trustedNode,
            staker,
            random;

        before(async () => {
            await globalSnapShot();

            [
                owner,
                node,
                trustedNode,
                staker,
                random,
            ] = await ethers.getSigners();

            // Register node
            await registerNode({ from: node });

            // Register trusted node
            await registerNode({ from: trustedNode });
            await setNodeTrusted(trustedNode, 'saas_1', 'node@home.com', owner);
        });

        //
        // Deposit
        //

        it(printTitle('staker', 'can make a deposit'), async () => {
            // Deposit
            await deposit({
                from: staker,
                value: '10'.ether,
            });

            // Get current rETH exchange rate
            let exchangeRate1 = await getRethExchangeRate();

            // Update network ETH total to 130% to alter rETH exchange rate
            let totalBalance = '13'.ether;
            let rethSupply = await getRethTotalSupply();
            let slotTimestamp = '1600000000';
            await submitBalances(1, slotTimestamp, totalBalance, 0, rethSupply, { from: trustedNode });

            // Get & check updated rETH exchange rate
            let exchangeRate2 = await getRethExchangeRate();
            assertBN.notEqual(exchangeRate1, exchangeRate2, 'rETH exchange rate has not changed');

            // Deposit again with updated rETH exchange rate
            await deposit({
                from: staker,
                value: '10'.ether,
            });
        });

        it(printTitle('staker', 'cannot make a deposit while deposits are disabled'), async () => {
            // Disable deposits
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.enabled', false, { from: owner });

            // Attempt deposit
            await shouldRevert(deposit({
                from: staker,
                value: '10'.ether,
            }), 'Made a deposit while deposits are disabled');
        });

        it(printTitle('staker', 'cannot make a deposit below the minimum deposit amount'), async () => {
            // Get & check deposit amount
            let minimumDeposit = await getDepositSetting('MinimumDeposit');
            let depositAmount = minimumDeposit / 2n;
            assertBN.isBelow(depositAmount, minimumDeposit, 'Deposit amount is not less than the minimum deposit');

            // Attempt deposit
            await shouldRevert(deposit({
                from: staker,
                value: depositAmount,
            }), 'Made a deposit below the minimum deposit amount');
        });

        it(printTitle('staker', 'cannot make a deposit which would exceed the maximum deposit pool size'), async () => {
            // Set max deposit pool size
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.pool.maximum', '100'.ether, { from: owner });

            // Attempt deposit
            await shouldRevert(deposit({
                from: staker,
                value: '101'.ether,
            }), 'Made a deposit which exceeds the maximum deposit pool size');
        });

        it(printTitle('staker', 'can make a deposit which exceeds the maximum deposit pool if minipool queue is larger'), async () => {
            // Set max deposit pool size to 1 ETH
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.pool.maximum', '1'.ether, { from: owner });
            // Disable socialised assignments so the deposit pool balance check succeeds
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.assign.socialised.maximum', 0, { from: owner });

            // Attempt deposit greater than maximum (fails)
            await shouldRevert(deposit({
                from: staker,
                value: '16'.ether,
            }), 'Made a deposit which exceeds the maximum deposit pool size');

            // Create a minipool to add to the queue
            let minipoolRplStake = await getMinipoolMinimumRPLStake();
            await mintRPL(owner, node, minipoolRplStake);
            await nodeStakeRPL(minipoolRplStake, { from: node });
            await createMinipool({ from: node, value: '16'.ether });

            // Attempt deposit
            await deposit({
                from: staker,
                value: '16'.ether,
            });
        });

        //
        // Assign deposits
        //

        it(printTitle('random address', 'can assign deposits'), async () => {
            // Assign deposits with no assignable deposits
            await assignDepositsV2({
                from: staker,
            });

            // Disable deposit assignment
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.assign.enabled', false, { from: owner });

            // Disable minimum unbonded commission threshold
            await setDAONodeTrustedBootstrapSetting(LQGDAONodeTrustedSettingsMembers, 'members.minipool.unbonded.min.fee', '0', { from: owner });

            // Stake RPL to cover minipools
            let minipoolRplStake = await getMinipoolMinimumRPLStake();
            let rplStake = minipoolRplStake * 3n;
            await mintRPL(owner, trustedNode, rplStake);
            await nodeStakeRPL(rplStake, { from: trustedNode });

            // Make user & node deposits
            await userDeposit({ from: staker, value: '100'.ether });
            await nodeDeposit({ from: trustedNode, value: '16'.ether });
            await nodeDeposit({ from: trustedNode, value: '16'.ether });
            await nodeDeposit({ from: trustedNode, value: '16'.ether });

            // Re-enable deposit assignment & set limit
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.assign.enabled', true, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.assign.maximum', 3, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.assign.socialised.maximum', 3, { from: owner });

            // Assign deposits with assignable deposits
            await assignDepositsV2({
                from: staker,
            });
        });

        it(printTitle('random address', 'cannot assign deposits while deposit assignment is disabled'), async () => {
            // Disable deposit assignment
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.assign.enabled', false, { from: owner });

            // Attempt to assign deposits
            await shouldRevert(assignDepositsV2({
                from: staker,
            }), 'Assigned deposits while deposit assignment is disabled');
        });

        //
        // Assign deposits
        //

        it(printTitle('random address', 'can check maximum deposit amount'), async () => {
            const lqgDepositPool = await LQGDepositPool.deployed();

            // Disable deposits
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.enabled', false, { from: owner });
            assertBN.equal(await lqgDepositPool.getMaximumDepositAmount(), 0, 'Invalid maximum deposit amount');

            // Enable deposits
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.enabled', true, { from: owner });
            const depositPoolMaximum = '100'.ether;
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.pool.maximum', depositPoolMaximum, { from: owner });
            assertBN.equal(await lqgDepositPool.getMaximumDepositAmount(), depositPoolMaximum, 'Invalid maximum deposit amount');

            // Create a 16 ETH minipool
            let minipoolRplStake = await getMinipoolMinimumRPLStake();
            let rplStake = minipoolRplStake * 1n;
            await mintRPL(owner, node, rplStake);
            await nodeStakeRPL(rplStake, { from: node });
            const minipoolBondAmount = '16'.ether;
            await createMinipool({ from: node, value: minipoolBondAmount });
            assertBN.equal(await lqgDepositPool.getMaximumDepositAmount(), depositPoolMaximum + minipoolBondAmount, 'Invalid maximum deposit amount');
        });
    });
}
