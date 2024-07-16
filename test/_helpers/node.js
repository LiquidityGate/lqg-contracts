import {
    LQGDAONodeTrusted,
    LQGDAONodeTrustedActions,
    LQGDAONodeTrustedSettingsMembers,
    LQGMinipoolFactory,
    LQGNetworkVoting,
    LQGNodeDeposit,
    LQGNodeManager,
    LQGNodeStaking,
    LQGStorage,
    LQGTokenRPL,
} from '../_utils/artifacts';
import { setDaoNodeTrustedBootstrapMember } from '../dao/scenario-dao-node-trusted-bootstrap';
import { daoNodeTrustedMemberJoin } from '../dao/scenario-dao-node-trusted';
import { mintDummyRPL } from '../token/scenario-rpl-mint-fixed';
import { burnFixedRPL } from '../token/scenario-rpl-burn-fixed';
import { allowDummyRPL } from '../token/scenario-rpl-allow-fixed';
import { getDepositDataRoot, getValidatorPubkey, getValidatorSignature } from '../_utils/beacon';
import { assertBN } from './bn';
import * as assert from 'assert';

// Get a node's RPL stake
export async function getNodeRPLStake(nodeAddress) {
    const lqgNodeStaking = await LQGNodeStaking.deployed();
    return lqgNodeStaking.getNodeRPLStake(nodeAddress);
}

// Get a node's effective RPL stake
export async function getNodeEffectiveRPLStake(nodeAddress) {
    const lqgNodeStaking = await LQGNodeStaking.deployed();
    return lqgNodeStaking.getNodeEffectiveRPLStake(nodeAddress);
}

// Get a node's minipool RPL stake
export async function getNodeMinimumRPLStake(nodeAddress) {
    const lqgNodeStaking = await LQGNodeStaking.deployed();
    return lqgNodeStaking.getNodeMinimumRPLStake(nodeAddress);
}

// Register a node
export async function registerNode(txOptions) {
    const lqgNodeManager = (await LQGNodeManager.deployed());
    await lqgNodeManager.connect(txOptions.from).registerNode('Australia/Brisbane');
}

// Get number of nodes
export async function getNodeCount() {
    const lqgNodeManager = await LQGNodeManager.deployed();
    return lqgNodeManager.getNodeCount();
}

// Make a node a trusted dao member, only works in bootstrap mode (< 3 trusted dao members)
export async function setNodeTrusted(_account, _id, _url, owner) {
    // Mints fixed supply RPL, burns that for new RPL and gives it to the account
    let rplMint = async function(_account, _amount) {
        // Load contracts
        const lqgTokenRPL = await LQGTokenRPL.deployed();
        // Mint RPL fixed supply for the users to simulate current users having RPL
        await mintDummyRPL(_account, _amount, { from: owner });
        // Mint a large amount of dummy RPL to owner, who then burns it for real RPL which is sent to nodes for testing below
        await allowDummyRPL(lqgTokenRPL.target, _amount, { from: _account });
        // Burn existing fixed supply RPL for new RPL
        await burnFixedRPL(_amount, { from: _account });
    };

    // Allow the given account to spend this users RPL
    let rplAllowanceDAO = async function(_account, _amount) {
        // Load contracts
        const lqgTokenRPL = await LQGTokenRPL.deployed();
        const lqgDAONodeTrustedActions = await LQGDAONodeTrustedActions.deployed();
        // Approve now
        await lqgTokenRPL.connect(_account).approve(lqgDAONodeTrustedActions.target, _amount, { from: _account });
    };

    // Get the DAO settings
    let daoNodesettings = await LQGDAONodeTrustedSettingsMembers.deployed();
    // How much RPL is required for a trusted node bond?
    let rplBondAmount = await daoNodesettings.getRPLBond();
    // Mint RPL bond required for them to join
    await rplMint(_account, rplBondAmount);
    // Set allowance for the Vault to grab the bond
    await rplAllowanceDAO(_account, rplBondAmount);
    // Create invites for them to become a member
    await setDaoNodeTrustedBootstrapMember(_id, _url, _account, { from: owner });
    // Now get them to join
    await daoNodeTrustedMemberJoin({ from: _account });
    // Check registration was successful and details are correct
    const lqgDAONodeTrusted = await LQGDAONodeTrusted.deployed();
    const id = await lqgDAONodeTrusted.getMemberID(_account);
    assert.equal(id, _id, 'Member ID is wrong');
    const url = await lqgDAONodeTrusted.getMemberUrl(_account);
    assert.equal(url, _url, 'Member URL is wrong');
    const joinedTime = await lqgDAONodeTrusted.getMemberJoinedTime(_account);
    assert.notEqual(joinedTime, 0n, 'Member joined time is wrong');
    const valid = await lqgDAONodeTrusted.getMemberIsValid(_account);
    assert.equal(valid, true, 'Member valid flag is not set');
}

// Set a withdrawal address for a node
export async function setNodeWithdrawalAddress(nodeAddress, withdrawalAddress, txOptions) {
    const lqgStorage = await LQGStorage.deployed();
    await lqgStorage.connect(txOptions.from).setWithdrawalAddress(nodeAddress, withdrawalAddress, true, txOptions);
}

// Set an RPL withdrawal address for a node
export async function setNodeRPLWithdrawalAddress(nodeAddress, rplWithdrawalAddress, txOptions) {
    const lqgNodeManager = await LQGNodeManager.deployed();
    await lqgNodeManager.connect(txOptions.from).setRPLWithdrawalAddress(nodeAddress, rplWithdrawalAddress, true, txOptions);
}

// Submit a node RPL stake
export async function nodeStakeRPL(amount, txOptions) {
    const [lqgNodeStaking, lqgTokenRPL] = await Promise.all([
        LQGNodeStaking.deployed(),
        LQGTokenRPL.deployed(),
    ]);
    await lqgTokenRPL.connect(txOptions.from).approve(lqgNodeStaking.target, amount);
    const before = await lqgNodeStaking.getNodeRPLStake(txOptions.from);
    await lqgNodeStaking.connect(txOptions.from).stakeRPL(amount);
    const after = await lqgNodeStaking.getNodeRPLStake(txOptions.from);
    assertBN.equal(after - before, amount, 'Staking balance did not increase by amount staked');
}

// Delegate voting power
export async function nodeSetDelegate(to, txOptions) {
    const lqgNetworkVoting = (await LQGNetworkVoting.deployed()).connect(txOptions.from);
    await lqgNetworkVoting.setDelegate(to, txOptions);
    const newDelegate = await lqgNetworkVoting.getCurrentDelegate(txOptions.from);
    assert.equal(newDelegate, to);
}

// Submit a node RPL stake on behalf of another node
export async function nodeStakeRPLFor(nodeAddress, amount, txOptions) {
    const [lqgNodeStaking, lqgTokenRPL] = await Promise.all([
        LQGNodeStaking.deployed(),
        LQGTokenRPL.deployed(),
    ]);
    await lqgTokenRPL.connect(txOptions.from).approve(lqgNodeStaking.target, amount, txOptions);
    const before = await lqgNodeStaking.getNodeRPLStake(nodeAddress);
    await lqgNodeStaking.connect(txOptions.from).stakeRPLFor(nodeAddress, amount, txOptions);
    const after = await lqgNodeStaking.getNodeRPLStake(nodeAddress);
    assertBN.equal(after - before, amount, 'Staking balance did not increase by amount staked');
}

// Deposits ETH into a node operator's balance
export async function nodeDepositEthFor(nodeAddress, txOptions) {
    const [lqgNodeDeposit] = await Promise.all([
        LQGNodeDeposit.deployed(),
    ]);
    const before = await lqgNodeDeposit.getNodeEthBalance(nodeAddress);
    await lqgNodeDeposit.connect(txOptions.from).depositEthFor(nodeAddress, txOptions);
    const after = await lqgNodeDeposit.getNodeEthBalance(nodeAddress);
    assertBN.equal(after - before, txOptions.value, 'ETH balance did not increase by msg.value');
}

// Sets allow state for staking on behalf
export async function setStakeRPLForAllowed(caller, state, txOptions) {
    const [lqgNodeStaking] = await Promise.all([
        LQGNodeStaking.deployed(),
    ]);
    await lqgNodeStaking.connect(txOptions.from)['setStakeRPLForAllowed(address,bool)'](caller, state, txOptions);
}

// Sets allow state for staking on behalf
export async function setStakeRPLForAllowedWithNodeAddress(nodeAddress, caller, state, txOptions) {
    const lqgNodeStaking = (await LQGNodeStaking.deployed()).connect(txOptions.from);
    await lqgNodeStaking['setStakeRPLForAllowed(address,address,bool)'](nodeAddress, caller, state, txOptions);
}

// Withdraw a node RPL stake
export async function nodeWithdrawRPL(amount, txOptions) {
    const lqgNodeStaking = (await LQGNodeStaking.deployed()).connect(txOptions.from);
    await lqgNodeStaking['withdrawRPL(uint256)'](amount, txOptions);
}

// Set allow state for RPL locking
export async function setRPLLockingAllowed(node, state, txOptions) {
    const lqgNodeStaking = (await LQGNodeStaking.deployed()).connect(txOptions.from);
    await lqgNodeStaking.connect(txOptions.from).setRPLLockingAllowed(node, state);
}

// Make a node deposit
let minipoolSalt = 0;

export async function nodeDeposit(txOptions) {
    // Load contracts
    const [
        lqgMinipoolFactory,
        lqgNodeDeposit,
        lqgStorage,
    ] = await Promise.all([
        LQGMinipoolFactory.deployed(),
        LQGNodeDeposit.deployed(),
        LQGStorage.deployed(),
    ]);

    const salt = minipoolSalt++;
    const minipoolAddress = (await lqgMinipoolFactory.getExpectedAddress(txOptions.from, salt)).substr(2);
    let withdrawalCredentials = '0x010000000000000000000000' + minipoolAddress;

    // Get validator deposit data
    let depositData = {
        pubkey: getValidatorPubkey(),
        withdrawalCredentials: Buffer.from(withdrawalCredentials.substr(2), 'hex'),
        amount: BigInt(1000000000), // 1 ETH in gwei
        signature: getValidatorSignature(),
    };

    let depositDataRoot = getDepositDataRoot(depositData);

    // Make node deposit
    await lqgNodeDeposit.connect(txOptions.from).deposit(txOptions.value, '0'.ether, depositData.pubkey, depositData.signature, depositDataRoot, salt, '0x' + minipoolAddress, txOptions);
}

// Get a node's deposit credit balance
export async function getNodeDepositCredit(nodeAddress) {
    const lqgNodeDeposit = (await LQGNodeDeposit.deployed());
    return lqgNodeDeposit.getNodeDepositCredit(nodeAddress);
}

// Get a node's effective RPL stake
export async function getNodeAverageFee(nodeAddress) {
    const lqgNodeManager = (await LQGNodeManager.deployed());
    return lqgNodeManager.getAverageNodeFee(nodeAddress);
}
