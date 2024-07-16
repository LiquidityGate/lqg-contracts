import {
    LQGDAOProposal,
    LQGDAOSecurity,
    LQGDAOSecurityActions,
    LQGDAOSecurityProposals,
} from '../_utils/artifacts';
import { getDAOProposalState, proposalStates } from './scenario-dao-proposal';
import { assertBN } from '../_helpers/bn';
import * as assert from 'assert';

// Returns true if the address is a DAO member
export async function getDAOSecurityMemberIsValid(_nodeAddress) {
    // Load contracts
    const lqgDAOSecurity = await LQGDAOSecurity.deployed();
    return await lqgDAOSecurity.getMemberIsValid(_nodeAddress);
}

// Get the total members
export async function getDAOSecurityMemberCount() {
    // Load contracts
    const lqgDAOSecurity = await LQGDAOSecurity.deployed();
    return await lqgDAOSecurity.getMemberCount();
}

// Get the number of votes needed for a proposal to pass
export async function getDAOSecurityProposalQuorumVotesRequired(proposalID) {
    // Load contracts
    const lqgDAOSecurity = await LQGDAOSecurity.deployed();
    return await lqgDAOSecurity.getProposalQuorumVotesRequired();
}

// Create a proposal for this DAO
export async function daoSecurityPropose(_proposalMessage, _payload, txOptions) {

    // Load contracts
    const lqgDAOProposal = await LQGDAOProposal.deployed();
    const lqgDAOSecurityProposals = await LQGDAOSecurityProposals.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAOProposal.getTotal(),
        ]).then(
            ([proposalTotal]) =>
                ({ proposalTotal }),
        );
    }

    // Capture data
    let ds1 = await getTxData();

    // Add a new proposal
    await lqgDAOSecurityProposals.connect(txOptions.from).propose(_proposalMessage, _payload, txOptions);

    // Capture data
    let ds2 = await getTxData();

    // Get the current state, new proposal should be in pending
    let state = Number(await getDAOProposalState(ds2.proposalTotal));

    // Check proposals
    assertBN.equal(ds2.proposalTotal, ds1.proposalTotal + 1n, 'Incorrect proposal total count');
    assert.strictEqual(state, proposalStates.Pending, 'Incorrect proposal state, should be pending');

    // Return the proposal ID
    return Number(ds2.proposalTotal);
}

// Vote on a proposal for this DAO
export async function daoSecurityVote(_proposalID, _vote, txOptions) {
    // Load contracts
    const lqgDAOProposal = await LQGDAOProposal.deployed();
    const lqgDAOSecurityProposals = await LQGDAOSecurityProposals.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAOProposal.getTotal(),
            lqgDAOProposal.getState(_proposalID),
            lqgDAOProposal.getVotesFor(_proposalID),
            lqgDAOProposal.getVotesRequired(_proposalID),
        ]).then(
            ([proposalTotal, proposalState, proposalVotesFor, proposalVotesRequired]) =>
                ({ proposalTotal, proposalState, proposalVotesFor, proposalVotesRequired }),
        );
    }

    // Add a new proposal
    await lqgDAOSecurityProposals.connect(txOptions.from).vote(_proposalID, _vote, txOptions);

    // Capture data
    let ds2 = await getTxData();

    // Check proposals
    if (ds2.proposalState === proposalStates.Active) {
        assertBN.isBelow(ds2.proposalVotesFor, ds2.proposalVotesRequired, 'Proposal state is active, votes for proposal should be less than the votes required');
    }
    if (ds2.proposalState === proposalStates.Succeeded) {
        assertBN.isAtLeast(ds2.proposalVotesFor, ds2.proposalVotesRequired, 'Proposal state is successful, yet does not have the votes required');
    }
}

// Execute a successful proposal
export async function daoSecurityExecute(_proposalID, txOptions) {
    // Load contracts
    const lqgDAOProposal = await LQGDAOProposal.deployed();
    const lqgDAOSecurityProposals = await LQGDAOSecurityProposals.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAOProposal.getState(_proposalID),
        ]).then(
            ([proposalState]) =>
                ({ proposalState }),
        );
    }

    // Execute a proposal
    await lqgDAOSecurityProposals.connect(txOptions.from).execute(_proposalID, txOptions);

    // Capture data
    let ds2 = await getTxData();

    // Check it was updated
    assertBN.equal(ds2.proposalState, proposalStates.Executed, 'Proposal is not in the executed state');
}

// Join the DAO after a successful invite proposal has passed
export async function daoSecurityMemberJoin(txOptions) {
    // Load contracts
    const lqgDAOSecurity = await LQGDAOSecurity.deployed();
    const lqgDAOSecurityActions = (await LQGDAOSecurityActions.deployed()).connect(txOptions.from);

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAOSecurity.getMemberCount(),
        ]).then(
            ([memberTotal]) =>
                ({ memberTotal }),
        );
    }

    // Capture data
    let ds1 = await getTxData();

    // Add a new proposal
    await lqgDAOSecurityActions.actionJoin(txOptions);

    // Capture data
    let ds2 = await getTxData();

    // Check member count has increased
    assertBN.equal(ds2.memberTotal, ds1.memberTotal + 1n, 'Member count has not increased');
}

// Leave the DAO after a successful leave proposal has passed
export async function daoSecurityMemberLeave(txOptions) {
    // Load contracts
    const lqgDAOSecurity = await LQGDAOSecurity.deployed();
    const lqgDAOSecurityActions = await LQGDAOSecurityActions.deployed();

    // Get data about the tx
    function getTxData() {
        return Promise.all([
            lqgDAOSecurity.getMemberCount(),
        ]).then(
            ([memberTotal]) =>
                ({ memberTotal }),
        );
    }

    // Capture data
    let ds1 = await getTxData();

    // Add a new proposal
    await lqgDAOSecurityActions.connect(txOptions.from).actionLeave(txOptions);

    // Capture data
    let ds2 = await getTxData();

    // Verify
    assertBN.equal(ds2.memberTotal, ds1.memberTotal - 1n, 'Member count has not decreased');
}

// Request leaving the security council
export async function daoSecurityMemberRequestLeave(txOptions) {
    const lqgDAOSecurityActions = await LQGDAOSecurityActions.deployed();
    await lqgDAOSecurityActions.connect(txOptions.from).actionRequestLeave(txOptions);
}


