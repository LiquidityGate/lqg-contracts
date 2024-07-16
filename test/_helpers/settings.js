import {
    LQGDAOProtocolSettingsAuction,
    LQGDAOProtocolSettingsDeposit,
    LQGDAOProtocolSettingsMinipool,
    LQGDAOProtocolSettingsNetwork,
    LQGDAOProtocolSettingsNode,
} from '../_utils/artifacts';

// Auction settings
export async function getAuctionSetting(setting) {
    const lqgAuctionSettings = await LQGDAOProtocolSettingsAuction.deployed();
    return lqgAuctionSettings['get' + setting]();
}

// Deposit settings
export async function getDepositSetting(setting) {
    const lqgDAOProtocolSettingsDeposit = await LQGDAOProtocolSettingsDeposit.deployed();
    return lqgDAOProtocolSettingsDeposit['get' + setting]();
}

// Minipool settings
export async function getMinipoolSetting(setting) {
    const lqgDAOProtocolSettingsMinipool = await LQGDAOProtocolSettingsMinipool.deployed();
    return lqgDAOProtocolSettingsMinipool['get' + setting]();
}

// Network settings
export async function getNetworkSetting(setting) {
    const lqgDAOProtocolSettingsNetwork = await LQGDAOProtocolSettingsNetwork.deployed();
    return lqgDAOProtocolSettingsNetwork['get' + setting]();
}

// Node settings
export async function getNodeSetting(setting) {
    const lqgDAOProtocolSettingsNode = await LQGDAOProtocolSettingsNode.deployed();
    return lqgDAOProtocolSettingsNode['get' + setting]();
}


