import { describe, it, before } from 'mocha';
import { printTitle } from '../_utils/formatting';
import { shouldRevert } from '../_utils/testing';
import { getDepositExcessBalance, userDeposit } from '../_helpers/deposit';
import { createMinipool, getMinipoolMinimumRPLStake, stakeMinipool } from '../_helpers/minipool';
import { submitBalances } from '../_helpers/network';
import { nodeStakeRPL, registerNode, setNodeTrusted, setNodeWithdrawalAddress } from '../_helpers/node';
import {
    depositExcessCollateral,
    getRethBalance,
    getRethCollateralRate,
    getRethExchangeRate,
    getRethTotalSupply,
    mintRPL,
} from '../_helpers/tokens';
import { burnReth } from './scenario-reth-burn';
import { transferReth } from './scenario-reth-transfer';
import {
    LQGDAONodeTrustedSettingsMinipool,
    LQGDAOProtocolSettingsMinipool,
    LQGDAOProtocolSettingsNetwork,
    LQGTokenRETH,
} from '../_utils/artifacts';
import { setDAOProtocolBootstrapSetting } from '../dao/scenario-dao-protocol-bootstrap';
import { beginUserDistribute, withdrawValidatorBalance } from '../minipool/scenario-withdraw-validator-balance';
import { setDAONodeTrustedBootstrapSetting } from '../dao/scenario-dao-node-trusted-bootstrap';
import { assertBN } from '../_helpers/bn';
import * as assert from 'assert';
import { globalSnapShot } from '../_utils/snapshotting';

const helpers = require('@nomicfoundation/hardhat-network-helpers');
const hre = require('hardhat');
const ethers = hre.ethers;

export default function() {
    describe('LQGTokenRETH', () => {
        let owner,
            node,
            nodeWithdrawalAddress,
            trustedNode,
            staker1,
            staker2,
            random;

        let scrubPeriod = (60 * 60 * 24); // 24 hours

        // Setup
        let minipool;
        let withdrawalBalance = '36'.ether;
        let rethBalance;
        let submitPricesFrequency = 500;
        let depositDeplay = 100;
        const userDistributeStartTime = 60 * 60 * 24 * 90; // 90 days

        before(async () => {
            await globalSnapShot();

            [
                owner,
                node,
                nodeWithdrawalAddress,
                trustedNode,
                staker1,
                staker2,
                random,
            ] = await ethers.getSigners();

            let slotTimestamp = '1600000000';

            // Get current rETH exchange rate
            let exchangeRate1 = await getRethExchangeRate();

            // Make deposit
            await userDeposit({ from: staker1, value: '16'.ether });

            // Register node & set withdrawal address
            await registerNode({ from: node });
            await setNodeWithdrawalAddress(node, nodeWithdrawalAddress, { from: node });

            // Register trusted node
            await registerNode({ from: trustedNode });
            await setNodeTrusted(trustedNode, 'saas_1', 'node@home.com', owner);

            // Set settings
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.reth.collateral.target', '1'.ether, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.submit.prices.frequency', submitPricesFrequency, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.reth.deposit.delay', depositDeplay, { from: owner });
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsMinipool, 'minipool.user.distribute.window.start', userDistributeStartTime, { from: owner });
            await setDAONodeTrustedBootstrapSetting(LQGDAONodeTrustedSettingsMinipool, 'minipool.scrub.period', scrubPeriod, { from: owner });

            // Stake RPL to cover minipools
            let rplStake = await getMinipoolMinimumRPLStake();
            await mintRPL(owner, node, rplStake);
            await nodeStakeRPL(rplStake, { from: node });

            // Create withdrawable minipool
            minipool = await createMinipool({ from: node, value: '16'.ether });
            await helpers.time.increase(scrubPeriod + 1);
            await stakeMinipool(minipool, { from: node });

            // Update network ETH total to alter rETH exchange rate
            let rethSupply = await getRethTotalSupply();
            let nodeFee = await minipool.getNodeFee.call();
            let depositBalance = '32'.ether;
            let userAmount = '16'.ether;
            let rewards = withdrawalBalance - depositBalance;
            let halfRewards = rewards / 2n;
            let nodeCommissionFee = halfRewards * nodeFee / '1'.ether;
            let ethBalance = userAmount + (halfRewards - nodeCommissionFee);
            await submitBalances(1, slotTimestamp, ethBalance, 0, rethSupply, { from: trustedNode });

            // Get & check staker rETH balance
            rethBalance = await getRethBalance(staker1);
            assertBN.isAbove(rethBalance, 0, 'Incorrect staker rETH balance');

            // Get & check updated rETH exchange rate
            let exchangeRate2 = await getRethExchangeRate();
            assert.notEqual(exchangeRate1, exchangeRate2, 'rETH exchange rate has not changed');
        });

        it(printTitle('rETH holder', 'can transfer rETH after enough time has passed'), async () => {
            // Make user deposit
            const depositAmount = '20'.ether;
            await userDeposit({ from: staker2, value: depositAmount });

            // Wait "network.reth.deposit.delay" blocks
            await helpers.mine(depositDeplay);

            // Transfer rETH
            await transferReth(random, rethBalance, {
                from: staker1,
            });
        });

        it(printTitle('rETH holder', 'can transfer rETH without waiting if received via transfer'), async () => {
            // Make user deposit
            const depositAmount = '20'.ether;
            await userDeposit({ from: staker2, value: depositAmount });

            // Wait "network.reth.deposit.delay" blocks
            await helpers.mine(depositDeplay);

            // Transfer rETH
            await transferReth(random, rethBalance, {
                from: staker1,
            });

            // Transfer rETH again
            await transferReth(staker1, rethBalance, {
                from: random,
            });
        });

        it(printTitle('rETH holder', 'can burn rETH for ETH collateral'), async () => {
            // Wait "network.reth.deposit.delay" blocks
            await helpers.mine(depositDeplay);

            // Send ETH to the minipool to simulate receiving from SWC
            await trustedNode.sendTransaction({
                to: minipool.target,
                value: withdrawalBalance,
            });

            // Begin user distribution process
            await beginUserDistribute(minipool, { from: random });
            // Wait
            await helpers.time.increase(userDistributeStartTime + 1);
            // Withdraw without finalising
            await withdrawValidatorBalance(minipool, '0'.ether, random);

            // Burn rETH
            await burnReth(rethBalance, {
                from: staker1,
            });
        });

        it(printTitle('rETH holder', 'can burn rETH for excess deposit pool ETH'), async () => {
            // Make user deposit
            const depositAmount = '20'.ether;
            await userDeposit({ from: staker2, value: depositAmount });

            // Check deposit pool excess balance
            let excessBalance = await getDepositExcessBalance();
            assertBN.equal(excessBalance, depositAmount, 'Incorrect deposit pool excess balance');

            // Wait "network.reth.deposit.delay" blocks
            await helpers.mine(depositDeplay);

            // Burn rETH
            await burnReth(rethBalance, {
                from: staker1,
            });
        });

        it(printTitle('rETH holder', 'cannot burn an invalid amount of rETH'), async () => {
            // Wait "network.reth.deposit.delay" blocks
            await helpers.mine(depositDeplay);

            // Send ETH to the minipool to simulate receving from SWC
            await trustedNode.sendTransaction({
                to: minipool.target,
                value: withdrawalBalance,
            });

            // Begin user distribution process
            await beginUserDistribute(minipool, { from: random });
            // Wait
            await helpers.time.increase(userDistributeStartTime + 1);
            // Withdraw without finalising
            await withdrawValidatorBalance(minipool, '0'.ether, random);

            // Get burn amounts
            let burnZero = '0'.ether;
            let burnExcess = '100'.ether;
            assertBN.isAbove(burnExcess, rethBalance, 'Burn amount does not exceed rETH balance');

            // Attempt to burn 0 rETH
            await shouldRevert(burnReth(burnZero, {
                from: staker1,
            }), 'Burned an invalid amount of rETH');

            // Attempt to burn too much rETH
            await shouldRevert(burnReth(burnExcess, {
                from: staker1,
            }), 'Burned an amount of rETH greater than the token balance');
        });

        it(printTitle('rETH holder', 'cannot burn rETH with insufficient collateral'), async () => {
            // Wait "network.reth.deposit.delay" blocks
            await helpers.mine(depositDeplay);

            // Attempt to burn rETH for contract collateral
            await shouldRevert(burnReth(rethBalance, {
                from: staker1,
            }), 'Burned rETH with an insufficient contract ETH balance');

            // Make user deposit
            const depositAmount = '10'.ether;
            await userDeposit({ from: staker2, value: depositAmount });

            // Check deposit pool excess balance
            let excessBalance = await getDepositExcessBalance();
            assertBN.equal(excessBalance, depositAmount, 'Incorrect deposit pool excess balance');

            // Attempt to burn rETH for excess deposit pool ETH
            await shouldRevert(burnReth(rethBalance, {
                from: staker1,
            }), 'Burned rETH with an insufficient deposit pool excess ETH balance');
        });

        it(printTitle('random', 'can deposit excess collateral into the deposit pool'), async () => {
            // Get rETH contract
            const lqgTokenRETH = await LQGTokenRETH.deployed();
            // Send enough ETH to rETH contract to exceed target collateralisation rate
            await random.sendTransaction({
                to: lqgTokenRETH.target,
                value: '32'.ether,
            });
            // Call the deposit excess function
            await depositExcessCollateral({ from: random });
            // Collateral should now be at the target rate
            const collateralRate = await getRethCollateralRate();
            // Collateral rate should now be 1 (the target rate)
            assertBN.equal(collateralRate, '1'.ether);
        });
    });
}
