import { setDAOProtocolBootstrapSetting } from '../dao/scenario-dao-protocol-bootstrap';
import {
    LQGDAOProtocolSettingsDeposit, LQGDAOProtocolSettingsInflation,
    LQGDAOProtocolSettingsMinipool, LQGDAOProtocolSettingsNetwork,
    LQGDAOProtocolSettingsNode
} from '../_utils/artifacts';

const hre = require('hardhat');
const ethers = hre.ethers;

export async function setDefaultParameters() {
    const [guardian] = await ethers.getSigners();
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.enabled', true, { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.assign.enabled', true, { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsDeposit, 'deposit.pool.maximum', '1000'.ether, { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNode, 'node.registration.enabled', true, { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNode, 'node.deposit.enabled', true, { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsMinipool, 'minipool.submit.withdrawable.enabled', true, { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.minimum', '0.05'.ether, { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.target', '0.1'.ether, { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.fee.maximum', '0.2'.ether, { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNetwork, 'network.node.demand.range', '1000'.ether, { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsInflation, 'rpl.inflation.interval.start', Math.floor(new Date().getTime() / 1000) + (60 * 60 * 24 * 14), { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsMinipool, 'minipool.bond.reduction.enabled', true, { from: guardian });
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsNode, 'node.vacant.minipools.enabled', true, { from: guardian });
}