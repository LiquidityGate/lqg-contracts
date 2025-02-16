import { LQGDAONodeTrusted, LQGStorage, LQGTokenRPL, LQGVault } from '../_utils/artifacts';
import { compressABI, decompressABI } from '../_utils/contract';
import { assertBN } from '../_helpers/bn';
import * as assert from 'assert';

const hre = require('hardhat');
const ethers = hre.ethers;

// The trusted node DAO can be bootstrapped with several nodes
export async function setDaoNodeTrustedBootstrapMember(_id, _url, _nodeAddress, txOptions) {
    // Load contracts
    const lqgDAONodeTrusted = await LQGDAONodeTrusted.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAONodeTrusted.getMemberID(_nodeAddress),
        ]).then(
            ([memberID]) =>
                ({ memberID }),
        );
    }

    // Set as a bootstrapped member
    await lqgDAONodeTrusted.connect(txOptions.from).bootstrapMember(_id, _url, _nodeAddress, txOptions);

    // Capture data
    let ds2 = await getTxData();

    // Check ID has been recorded
    assert.strictEqual(ds2.memberID, _id, 'Member was not invited to join correctly');
}

// Change a trusted node DAO setting while bootstrap mode is enabled
export async function setDAONodeTrustedBootstrapSetting(_settingContractInstance, _settingPath, _value, txOptions) {
    // Helper function
    String.prototype.lowerCaseFirstLetter = function() {
        return this.charAt(0).toLowerCase() + this.slice(1);
    };

    // Load contracts
    const lqgDAONodeTrusted = await LQGDAONodeTrusted.deployed();
    const lqgDAONodeTrustedSettingsContract = await _settingContractInstance.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAONodeTrustedSettingsContract.getSettingUint(_settingPath),
            lqgDAONodeTrustedSettingsContract.getSettingBool(_settingPath),
        ]).then(
            ([settingUintValue, settingBoolValue]) =>
                ({ settingUintValue, settingBoolValue }),
        );
    }

    // Set as a bootstrapped setting. detect type first, can be a number, string or bn object
    if (typeof (_value) == 'number' || typeof (_value) == 'string' || typeof (_value) == 'bigint') {
        await lqgDAONodeTrusted.connect(txOptions.from).bootstrapSettingUint(_settingContractInstance.name.lowerCaseFirstLetter(), _settingPath, _value, txOptions);
    }
    if (typeof (_value) == 'boolean') {
        await lqgDAONodeTrusted.connect(txOptions.from).bootstrapSettingBool(_settingContractInstance.name.lowerCaseFirstLetter(), _settingPath, _value, txOptions);
    }

    // Capture data
    let ds2 = await getTxData();

    // Check it was updated
    if (typeof (_value) == 'number' || typeof (_value) == 'string' || typeof (_value) == 'bigint') {
        await assertBN.equal(ds2.settingUintValue, _value, 'DAO node trusted uint256 setting not updated in bootstrap mode');
    }
    if (typeof (_value) == 'boolean') {
        await assert.strictEqual(ds2.settingBoolValue, _value, 'DAO node trusted boolean setting not updated in bootstrap mode');
    }
}

// Disable bootstrap mode
export async function setDaoNodeTrustedBootstrapModeDisabled(txOptions) {
    // Load contracts
    const lqgDAONodeTrusted = await LQGDAONodeTrusted.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAONodeTrusted.getBootstrapModeDisabled(),
        ]).then(
            ([bootstrapmodeDisabled]) =>
                ({ bootstrapmodeDisabled }),
        );
    }

    // Set as a bootstrapped member
    await lqgDAONodeTrusted.bootstrapDisable(true, txOptions);

    // Capture data
    let ds2 = await getTxData();

    // Check ID has been recorded
    assert.strictEqual(ds2.bootstrapmodeDisabled, true, 'Bootstrap mode was not disabled');
}

// The trusted node DAO can also upgrade contracts + abi if consensus is reached
export async function setDaoNodeTrustedBootstrapUpgrade(_type, _name, _abi, _contractAddress, txOptions) {
    // Load contracts
    const [
        lqgStorage,
        lqgDAONodeTrusted,
    ] = await Promise.all([
        LQGStorage.deployed(),
        LQGDAONodeTrusted.deployed(),
    ]);

    // Add test method to ABI
    let compressedAbi = '';
    if (Array.isArray(_abi)) {
        let testAbi = _abi.slice();
        testAbi.push({
            'constant': true,
            'inputs': [],
            'name': 'testMethod',
            'outputs': [{
                'name': '',
                'type': 'uint8',
            }],
            'payable': false,
            'stateMutability': 'view',
            'type': 'function',
        });
        compressedAbi = compressABI(testAbi);
    }

    // Get contract data
    function getContractData() {
        return Promise.all([
            lqgStorage['getAddress(bytes32)'](ethers.solidityPackedKeccak256(['string', 'string'], ['contract.address', _name])),
            lqgStorage.getString(ethers.solidityPackedKeccak256(['string', 'string'], ['contract.abi', _name])),
        ]).then(
            ([address, abi]) =>
                ({ address, abi }),
        );
    }

    function getContractAddressData(_contractAddress) {
        return Promise.all([
            lqgStorage.getBool(ethers.solidityPackedKeccak256(['string', 'address'], ['contract.exists', _contractAddress])),
            lqgStorage.getString(ethers.solidityPackedKeccak256(['string', 'address'], ['contract.name', _contractAddress])),
        ]).then(
            ([exists, name]) =>
                ({ exists, name }),
        );
    }

    // Get initial contract data
    let contract1 = await getContractData();

    // Upgrade contract
    await lqgDAONodeTrusted.connect(txOptions.from).bootstrapUpgrade(_type, _name, compressedAbi, _contractAddress, txOptions);

    // Get updated contract data
    let contract2 = await getContractData();
    let [oldContractData, newContractData] = await Promise.all([
        getContractAddressData(contract1.address),
        getContractAddressData(contract2.address),
    ]);

    // Initialise new contract from stored data
    let newContract = new ethers.Contract(contract2.address, decompressABI(contract2.abi));

    // Check different assertions based on upgrade type
    if (_type === 'upgradeContract') {
        // Check contract details
        assert.strictEqual(contract2.address, _contractAddress, 'Contract address was not successfully upgraded');
        assert.notEqual(newContract.testMethod, undefined, 'Contract ABI was not successfully upgraded');
        assert.equal(oldContractData.exists, false, 'Old contract address exists flag was not unset');
        assert.strictEqual(oldContractData.name, '', 'Old contract address name was not unset');
        assert.equal(newContractData.exists, true, 'New contract exists flag was not set');
        assert.notEqual(newContractData.name, '', 'New contract name was not set');
    }
    if (_type === 'addContract') {
        // Check contract details
        assert.strictEqual(contract2.address, _contractAddress, 'Contract address was not set');
        assert.notEqual(newContract.testMethod, undefined, 'Contract ABI was not set');
        assert.equal(newContractData.exists, true, 'New contract exists flag was not set');
        assert.notEqual(newContractData.name, '', 'New contract name was not set');
    }
    if (_type === 'upgradeABI' || _type === 'addABI') {
        // Check ABI details
        let contractAbi = await lqgStorage.getString(ethers.solidityPackedKeccak256(['string', 'string'], ['contract.abi', _name]));
        let contract = new ethers.Contract('0x0000000000000000000000000000000000000000', decompressABI(contractAbi));
        assert.notEqual(contract.testMethod, undefined, 'Contract ABI was not set');
    }
}

// A registered node attempting to join as a member due to low DAO member count
export async function setDaoNodeTrustedMemberRequired(_id, _url, txOptions) {
    // Load contracts
    const lqgDAONodeTrusted = await LQGDAONodeTrusted.deployed();
    const lqgVault = await LQGVault.deployed();
    const lqgTokenRPL = await LQGTokenRPL.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAONodeTrusted.getMemberCount(),
            lqgTokenRPL.balanceOf(txOptions.from),
            lqgVault.balanceOfToken('lqgDAONodeTrustedActions', lqgTokenRPL.target),
        ]).then(
            ([memberTotal, rplBalanceBond, rplBalanceVault]) =>
                ({ memberTotal, rplBalanceBond, rplBalanceVault }),
        );
    }

    // Capture data
    let ds1 = await getTxData();

    // Add a new proposal
    await lqgDAONodeTrusted.connect(txOptions.from).memberJoinRequired(_id, _url, txOptions);

    // Capture data
    let ds2 = await getTxData();

    // Check member count has increased
    assertBN.equal(ds2.memberTotal, ds1.memberTotal + 1n, 'Member count has not increased');
    assertBN.equal(ds2.rplBalanceVault, ds1.rplBalanceVault + ds1.rplBalanceBond, 'LQGVault address does not contain the correct RPL bond amount');
}
