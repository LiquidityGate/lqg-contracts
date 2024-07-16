import {
    LQGClaimDAO,
    LQGDAOProtocol,
    LQGDAOProtocolSettingsInflation,
    LQGDAOProtocolSettingsRewards,
    LQGTokenRPL,
    LQGVault,
} from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';
import * as assert from 'assert';

const hre = require('hardhat');
const ethers = hre.ethers;

// Change a trusted node DAO setting while bootstrap mode is enabled
export async function setDAOProtocolBootstrapSetting(_settingContractInstance, _settingPath, _value, txOptions) {

    // Helper function
    String.prototype.lowerCaseFirstLetter = function() {
        return this.charAt(0).toLowerCase() + this.slice(1);
    };

    // Load contracts
    const lqgDAOProtocol = (await LQGDAOProtocol.deployed()).connect(txOptions.from);
    const lqgDAOProtocolSettingsContract = await _settingContractInstance.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAOProtocolSettingsContract.getSettingUint(_settingPath),
            lqgDAOProtocolSettingsContract.getSettingBool(_settingPath),
            lqgDAOProtocolSettingsContract.getSettingAddress(_settingPath),
        ]).then(
            ([settingUintValue, settingBoolValue, settingAddressValue]) =>
                ({ settingUintValue, settingBoolValue, settingAddressValue }),
        );
    }

    // Capture data
    let ds1 = await getTxData();

    let contractName = _settingContractInstance.name.lowerCaseFirstLetter();

    // Set as a bootstrapped setting. detect type first, can be a number, string or bn object
    if (ethers.isAddress(_value)) {
        await lqgDAOProtocol.bootstrapSettingAddress(contractName, _settingPath, _value, txOptions);
    } else {
        if (typeof (_value) == 'number' || typeof (_value) == 'string' || typeof (_value) == 'bigint') await lqgDAOProtocol.bootstrapSettingUint(contractName, _settingPath, _value, txOptions);
        if (typeof (_value) == 'boolean') await lqgDAOProtocol.bootstrapSettingBool(contractName, _settingPath, _value, txOptions);
    }

    // Capture data
    let ds2 = await getTxData();

    // Check it was updated
    if (ethers.isAddress(_value)) {
        assert.strictEqual(ds2.settingAddressValue, _value, 'DAO protocol address setting not updated in bootstrap mode');
    } else {
        if (typeof (_value) == 'number' || typeof (_value) == 'string' || typeof (_value) == 'bigint') {
            assertBN.equal(ds2.settingUintValue, _value, 'DAO protocol uint256 setting not updated in bootstrap mode');
        }
        if (typeof (_value) == 'boolean') {
            assert.strictEqual(ds2.settingBoolValue, _value, 'DAO protocol boolean setting not updated in bootstrap mode');
        }
    }
}

// Set a contract that can claim rewards
export async function setDAONetworkBootstrapRewardsClaimers(_trustedNodePerc, _protocolPerc, _nodePerc, txOptions) {
    // Load contracts
    const lqgDAOProtocol = await LQGDAOProtocol.deployed();
    const lqgDAOProtocolSettingsRewards = await LQGDAOProtocolSettingsRewards.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAOProtocolSettingsRewards.getRewardsClaimersPerc(),
        ]).then(
            ([rewardsClaimerPerc]) =>
                ({ rewardsClaimerPerc }),
        );
    }

    // Perform tx
    await lqgDAOProtocol.connect(txOptions.from).bootstrapSettingClaimers(_trustedNodePerc, _protocolPerc, _nodePerc, txOptions);
    // Capture data
    let dataSet2 = await getTxData();
    // Verify
    assertBN.equal(dataSet2.rewardsClaimerPerc[0], _trustedNodePerc, 'Claim percentage not updated correctly');
    assertBN.equal(dataSet2.rewardsClaimerPerc[1], _protocolPerc, 'Claim percentage not updated correctly');
    assertBN.equal(dataSet2.rewardsClaimerPerc[2], _nodePerc, 'Claim percentage not updated correctly');
}

/*** Rewards *******/

// Set the current rewards claim period in seconds
export async function setRewardsClaimIntervalTime(intervalTime, txOptions) {
    // Set it now
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsRewards, 'rpl.rewards.claim.period.time', intervalTime, txOptions);
}

// Spend the DAO treasury in bootstrap mode
export async function spendRewardsClaimTreasury(_invoiceID, _recipientAddress, _amount, txOptions) {
    // Load contracts
    const lqgDAOProtocol = await LQGDAOProtocol.deployed();
    const lqgTokenRPL = await LQGTokenRPL.deployed();
    const lqgVault = await LQGVault.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgVault.balanceOfToken('lqgClaimDAO', lqgTokenRPL.address),
            lqgTokenRPL.balanceOf(_recipientAddress),
        ]).then(
            ([daoClaimTreasuryBalance, recipientBalance]) =>
                ({ daoClaimTreasuryBalance, recipientBalance }),
        );
    }

    // Capture data
    let ds1 = await getTxData();

    // console.log(web3.utils.fromWei(ds1.daoClaimTreasuryBalance), web3.utils.fromWei(ds1.recipientBalance), web3.utils.fromWei(_amount));

    // Perform tx
    await lqgDAOProtocol.bootstrapSpendTreasury(_invoiceID, _recipientAddress, _amount, txOptions);

    // Capture data
    let ds2 = await getTxData();

    // console.log(web3.utils.fromWei(ds2.daoClaimTreasuryBalance), web3.utils.fromWei(ds2.recipientBalance), web3.utils.fromWei(_amount));

    // Verify the amount sent is correct
    assertBN.equal(ds2.recipientBalance, ds1.recipientBalance.add(_amount), 'Amount spent by treasury does not match recipients received amount');
}

// Create a new recurring payment via bootstrap
export async function bootstrapTreasuryNewContract(_contractName, _recipientAddress, _amount, _periodLength, _startTime, _numPeriods, txOptions) {
    // Load contracts
    const lqgDAOProtocol = await LQGDAOProtocol.deployed();
    const lqgClaimDAO = await LQGClaimDAO.deployed();

    // Perform tx
    await lqgDAOProtocol.bootstrapTreasuryNewContract(_contractName, _recipientAddress, _amount, _periodLength, _startTime, _numPeriods, txOptions);

    // Sanity check
    const contract = await lqgClaimDAO.getContract(_contractName);
    assert.strictEqual(contract.recipient, _recipientAddress);
    assertBN.equal(contract.amountPerPeriod, _amount, 'Invalid amount');
    assert.strictEqual(Number(contract.periodLength), _periodLength);
    assert.strictEqual(Number(contract.numPeriods), _numPeriods);
    assert.strictEqual(Number(contract.lastPaymentTime), _startTime);
}

// Update an existing recurring payment via bootstrap
export async function bootstrapTreasuryUpdateContract(_contractName, _recipientAddress, _amount, _periodLength, _numPeriods, txOptions) {
    // Load contracts
    const lqgDAOProtocol = await LQGDAOProtocol.deployed();
    const lqgClaimDAO = await LQGClaimDAO.deployed();

    // Perform tx
    await lqgDAOProtocol.bootstrapTreasuryUpdateContract(_contractName, _recipientAddress, _amount, _periodLength, _numPeriods, txOptions);

    // Sanity check
    const contract = await lqgClaimDAO.getContract(_contractName);
    assert.strictEqual(contract.recipient, _recipientAddress);
    assertBN.equal(contract.amountPerPeriod, _amount, 'Invalid amount');
    assert.strictEqual(Number(contract.periodLength), _periodLength);
    assert.strictEqual(Number(contract.numPeriods), _numPeriods);
}

/*** Inflation *******/

// Set the current RPL inflation rate
export async function setRPLInflationIntervalRate(yearlyInflationPerc, txOptions) {
    // Calculate the inflation rate per day
    let dailyInflation = ((1 + yearlyInflationPerc) ** (1 / (365))).toFixed(18).ether;
    // Set it now
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsInflation, 'rpl.inflation.interval.rate', dailyInflation, txOptions);
}

// Set the current RPL inflation block interval
export async function setRPLInflationStartTime(startTime, txOptions) {
    // Set it now
    await setDAOProtocolBootstrapSetting(LQGDAOProtocolSettingsInflation, 'rpl.inflation.interval.start', startTime, txOptions);
}

// Disable bootstrap mode
export async function setDaoProtocolBootstrapModeDisabled(txOptions) {
    // Load contracts
    const lqgDAOProtocol = await LQGDAOProtocol.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAOProtocol.getBootstrapModeDisabled(),
        ]).then(
            ([bootstrapmodeDisabled]) =>
                ({ bootstrapmodeDisabled }),
        );
    }

    // Capture data
    let ds1 = await getTxData();

    // Set as a bootstrapped member
    await lqgDAOProtocol.bootstrapDisable(true, txOptions);

    // Capture data
    let ds2 = await getTxData();

    // Check ID has been recorded
    assert.strictEqual(ds2.bootstrapmodeDisabled, true, 'Bootstrap mode was not disabled');
}

// Change multiple trusted node DAO settings while bootstrap mode is enabled
export async function setDAOProtocolBootstrapSettingMulti(_settingContractInstances, _settingPaths, _values, txOptions) {
    // Helper function
    String.prototype.lowerCaseFirstLetter = function() {
        return this.charAt(0).toLowerCase() + this.slice(1);
    };

    // Load contracts
    const lqgDAOProtocol = (await LQGDAOProtocol.deployed()).connect(txOptions.from);

    const contractNames = [];
    const values = [];
    const types = [];

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();

    for (let i = 0; i < _settingContractInstances.length; i++) {
        const value = _values[i];
        contractNames.push(_settingContractInstances[i].name.lowerCaseFirstLetter());
        if (ethers.isAddress(value)) {
            values.push(abiCoder.encode(['address'], [value]));
            types.push(2);
        } else {
            if (typeof (value) == 'number' || typeof (value) == 'string' || typeof (value) == 'bigint') {
                values.push(abiCoder.encode(['uint256'], [value]));
                types.push(0);
            } else if (typeof (value) == 'boolean') {
                values.push(abiCoder.encode(['bool'], [value]));
                types.push(1);
            } else {
                throw new Error('Invalid value supplied');
            }
        }
    }

    // Set as a bootstrapped setting. detect type first, can be a number, string or bn object
    await lqgDAOProtocol.bootstrapSettingMulti(contractNames, _settingPaths, types, values, txOptions);

    // Get data about the tx
    async function getTxData() {
        const instances = await Promise.all(_settingContractInstances.map(instance => instance.deployed()));
        return Promise.all(instances.map((lqgDAOProtocolSettingsContract, index) => {
            switch (types[index]) {
                case 0:
                    return lqgDAOProtocolSettingsContract.getSettingUint(_settingPaths[index]);
                case 1:
                    return lqgDAOProtocolSettingsContract.getSettingBool(_settingPaths[index]);
                case 2:
                    return lqgDAOProtocolSettingsContract.getSettingAddress(_settingPaths[index]);
            }
        }));
    }

    // Capture data
    let data = await getTxData();

    // Check it was updated
    for (let i = 0; i < _values.length; i++) {
        const value = _values[i];
        switch (types[i]) {
            case 0:
                assertBN.equal(data[i], value, 'DAO protocol uint256 setting not updated in bootstrap mode');
                break;
            case 1:
                assert.strictEqual(data[i], value, 'DAO protocol boolean setting not updated in bootstrap mode');
                break;
            case 2:
                assert.strictEqual(data[i], value, 'DAO protocol address setting not updated in bootstrap mode');
                break;
        }
    }
}

export async function setDAOProtocolBootstrapEnableGovernance(txOptions) {
    // Load contracts
    const lqgDAOProtocol = (await LQGDAOProtocol.deployed()).connect(txOptions.from);
    // Execute enable transaction
    await lqgDAOProtocol.bootstrapEnableGovernance(txOptions);
}

/*** Security council *******/

// Use bootstrap power to invite a member to the security council
export async function setDAOProtocolBootstrapSecurityInvite(_id, _memberAddress, txOptions) {
    // Load contracts
    const lqgDAOProtocol = (await LQGDAOProtocol.deployed()).connect(txOptions.from);
    // Execute the invite
    await lqgDAOProtocol.bootstrapSecurityInvite(_id, _memberAddress, txOptions);
}

// Use bootstrap power to kick a member from the security council
export async function setDAOProtocolBootstrapSecurityKick(_id, _memberAddress, txOptions) {
    // Load contracts
    const lqgDAOProtocol = (await LQGDAOProtocol.deployed()).connect(txOptions.from);
    // Execute the kick
    await lqgDAOProtocol.bootstrapSecurityKick(_memberAddress, txOptions);
}
