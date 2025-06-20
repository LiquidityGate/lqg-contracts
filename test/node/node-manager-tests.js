import { before, describe, it } from 'mocha';
import { printTitle } from '../_utils/formatting';
import { shouldRevert } from '../_utils/testing';
import { registerNode } from '../_helpers/node';
import { LQGDAOProtocolSettingsNode, LQGNodeManager } from '../_utils/artifacts';
import { setDAOProtocolBootstrapSetting, setRewardsClaimIntervalTime } from '../dao/scenario-dao-protocol-bootstrap';
import { register } from './scenario-register';
import { setTimezoneLocation } from './scenario-set-timezone';
import { confirmWithdrawalAddress, setWithdrawalAddress } from './scenario-set-withdrawal-address';
import { setSmoothingPoolRegistrationState } from './scenario-register-smoothing-pool';
import { globalSnapShot } from '../_utils/snapshotting';
import * as assert from 'assert';

const helpers = require('@nomicfoundation/hardhat-network-helpers');
const hre = require('hardhat');
const ethers = hre.ethers;

export default function() {
    describe('LQGNodeManager', () => {
        let owner,
            node,
            registeredNode1,
            registeredNode2,
            withdrawalAddress1,
            withdrawalAddress2,
            withdrawalAddress3,
            random,
            random2,
            random3;

        // Constants
        const ONE_DAY = 24 * 60 * 60;
        const claimIntervalTime = ONE_DAY * 28;

        // Setup
        before(async () => {
            await globalSnapShot();

            [
                owner,
                node,
                registeredNode1,
                registeredNode2,
                withdrawalAddress1,
                withdrawalAddress2,
                withdrawalAddress3,
                random,
                random2,
                random3,
            ] = await ethers.getSigners();

            // Enable smoothing pool registrations
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNode, 'node.smoothing.pool.registration.enabled', true, { from: owner });

            // Register nodes
            await registerNode({ from: registeredNode1 });
            await registerNode({ from: registeredNode2 });

            // Set the claim interval blocks
            await setRewardsClaimIntervalTime(claimIntervalTime, { from: owner });
        });

        //
        // Registration
        //

        it(printTitle('node operator', 'can register a node'), async () => {
            // Register node
            await register('Australia/Brisbane', {
                from: node,
            });
        });

        it(printTitle('node operator', 'cannot register a node while registrations are disabled'), async () => {
            // Disable registrations
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNode, 'node.registration.enabled', false, { from: owner });

            // Attempt registration
            await shouldRevert(register('Australia/Brisbane', {
                from: node,
            }), 'Registered a node while registrations were disabled');
        });

        it(printTitle('node operator', 'cannot register a node with an invalid timezone location'), async () => {
            // Attempt to register node
            await shouldRevert(register('a', {
                from: node,
            }), 'Registered a node with an invalid timezone location');
        });

        it(printTitle('node operator', 'cannot register a node which is already registered'), async () => {
            // Register
            await register('Australia/Brisbane', { from: node });

            // Attempt second registration
            await shouldRevert(register('Australia/Brisbane', {
                from: node,
            }), 'Registered a node which is already registered');
        });

        //
        // Withdrawal address
        //

        it(printTitle('node operator', 'can set their withdrawal address immediately'), async () => {
            // Set withdrawal address
            await setWithdrawalAddress(registeredNode1, withdrawalAddress1.address, true, {
                from: registeredNode1,
            });

            // Set withdrawal address again
            await setWithdrawalAddress(registeredNode1, withdrawalAddress2.address, true, {
                from: withdrawalAddress1,
            });
        });

        it(printTitle('node operator', 'can set their withdrawal address to the same value as another node operator'), async () => {
            // Set withdrawal addresses
            await setWithdrawalAddress(registeredNode1, withdrawalAddress1.address, true, {
                from: registeredNode1,
            });

            await setWithdrawalAddress(registeredNode2, withdrawalAddress1.address, true, {
                from: registeredNode2,
            });

            // Set withdrawal addresses again
            await setWithdrawalAddress(registeredNode1, withdrawalAddress2.address, true, {
                from: withdrawalAddress1,
            });

            await setWithdrawalAddress(registeredNode2, withdrawalAddress2.address, true, {
                from: withdrawalAddress1,
            });
        });

        it(printTitle('node operator', 'cannot set their withdrawal address to an invalid address'), async () => {
            // Attempt to set withdrawal address
            await shouldRevert(setWithdrawalAddress(registeredNode1, '0x0000000000000000000000000000000000000000', true, {
                from: registeredNode1,
            }), 'Set a withdrawal address to an invalid address');
        });

        it(printTitle('random address', 'cannot set a withdrawal address'), async () => {
            // Attempt to set withdrawal address
            await shouldRevert(setWithdrawalAddress(registeredNode1, withdrawalAddress1.address, true, {
                from: random,
            }), 'Random address set a withdrawal address');
        });

        it(printTitle('node operator', 'can set and confirm their withdrawal address'), async () => {
            // Set & confirm withdrawal address
            await setWithdrawalAddress(registeredNode1, withdrawalAddress1.address, false, {
                from: registeredNode1,
            });
            await confirmWithdrawalAddress(registeredNode1, {
                from: withdrawalAddress1,
            });

            // Set & confirm withdrawal address again
            await setWithdrawalAddress(registeredNode1, withdrawalAddress2.address, false, {
                from: withdrawalAddress1,
            });
            await confirmWithdrawalAddress(registeredNode1, {
                from: withdrawalAddress2,
            });
        });

        it(printTitle('random address', 'cannot confirm itself as a withdrawal address'), async () => {
            // Attempt to confirm a withdrawal address
            await shouldRevert(confirmWithdrawalAddress(registeredNode1, {
                from: random,
            }), 'Random address confirmed itself as a withdrawal address');
        });

        //
        // Timezone location
        //

        it(printTitle('node operator', 'can set their timezone location'), async () => {
            // Set timezone location
            await setTimezoneLocation('Australia/Sydney', {
                from: registeredNode1,
            });
        });

        it(printTitle('node operator', 'cannot set their timezone location to an invalid value'), async () => {
            // Attempt to set timezone location
            await shouldRevert(setTimezoneLocation('a', {
                from: registeredNode1,
            }), 'Set a timezone location to an invalid value');
        });

        it(printTitle('random address', 'cannot set a timezone location'), async () => {
            // Attempt to set timezone location
            await shouldRevert(setTimezoneLocation('Australia/Brisbane', {
                from: random,
            }), 'Random address set a timezone location');
        });

        //
        // Smoothing pool
        //

        it(printTitle('node operator', 'can not register for smoothing pool if registrations are disabled'), async () => {
            await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNode, 'node.smoothing.pool.registration.enabled', false, { from: owner });
            await shouldRevert(setSmoothingPoolRegistrationState(true, { from: registeredNode1 }), 'Was able to register while registrations were disabled', 'Smoothing pool registrations are not active');
        });

        it(printTitle('node operator', 'can set their smoothing pool registration state'), async () => {
            await setSmoothingPoolRegistrationState(true, { from: registeredNode1 });
        });

        it(printTitle('node operator', 'can not set their smoothing pool registration state to the same value'), async () => {
            await shouldRevert(setSmoothingPoolRegistrationState(false, { from: registeredNode1 }), 'Was able to change smoothing pool registration state', 'Invalid state change');
        });

        it(printTitle('node operator', 'can not set their smoothing pool registration state before a reward interval has passed'), async () => {
            await setSmoothingPoolRegistrationState(true, { from: registeredNode1 });
            await shouldRevert(setSmoothingPoolRegistrationState(false, { from: registeredNode1 }), 'Was able to change smoothing pool registration state', 'Not enough time has passed since changing state');
        });

        it(printTitle('node operator', 'can set their smoothing pool registration state after a reward interval has passed'), async () => {
            await setSmoothingPoolRegistrationState(true, { from: registeredNode1 });
            await helpers.time.increase(claimIntervalTime + 1);
            await setSmoothingPoolRegistrationState(false, { from: registeredNode1 });
        });

        //
        // Misc
        //

        it(printTitle('random', 'can query timezone counts'), async () => {
            const lqgNodeManager = await LQGNodeManager.deployed();
            await lqgNodeManager.connect(random2).registerNode('Australia/Sydney');
            await lqgNodeManager.connect(random3).registerNode('Australia/Perth');

            const timezones = await lqgNodeManager.getNodeCountPerTimezone(0, 0);

            const expects = {
                'Australia/Brisbane': 2,
                'Australia/Sydney': 1,
                'Australia/Perth': 1,
            };

            for (const expectTimezone in expects) {
                const actual = timezones.find(tz => tz.timezone === expectTimezone);
                assert.equal(actual && Number(actual.count) === expects[expectTimezone], true, 'Timezone count was incorrect for ' + expectTimezone + ', expected ' + expects[expectTimezone] + ' but got ' + actual);
            }
        });

    });
}
