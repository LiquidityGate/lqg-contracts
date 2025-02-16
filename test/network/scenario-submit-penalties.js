import {
    LQGDAONodeTrusted,
    LQGDAOProtocolSettingsNetwork,
    LQGMinipoolPenalty,
    LQGNetworkPenalties,
    LQGStorage,
} from '../_utils/artifacts';
import { shouldRevert } from '../_utils/testing';
import { assertBN } from '../_helpers/bn';
import * as assert from 'assert';

const hre = require('hardhat');
const ethers = hre.ethers;

// Submit network penalties
export async function submitPenalty(minipoolAddress, block, txOptions) {

    // Load contracts
    const [
        lqgDAONodeTrusted,
        lqgNetworkPenalties,
        lqgMinipoolPenalty,
        lqgStorage,
        lqgDAOProtocolSettingsNetwork,
    ] = await Promise.all([
        LQGDAONodeTrusted.deployed(),
        LQGNetworkPenalties.deployed(),
        LQGMinipoolPenalty.deployed(),
        LQGStorage.deployed(),
        LQGDAOProtocolSettingsNetwork.deployed(),
    ]);

    // Get parameters
    let trustedNodeCount = await lqgDAONodeTrusted.getMemberCount();

    // Get submission keys
    let penaltyKey = ethers.solidityPackedKeccak256(['string', 'address'], ['network.penalties.penalty', minipoolAddress]);
    let nodeSubmissionKey = ethers.solidityPackedKeccak256(['string', 'address', 'address', 'uint256'], ['network.penalties.submitted.node', txOptions.from.address, minipoolAddress, block]);
    let submissionCountKey = ethers.solidityPackedKeccak256(['string', 'address', 'uint256'], ['network.penalties.submitted.count', minipoolAddress, block]);
    let executionKey = ethers.solidityPackedKeccak256(['string', 'address', 'uint256'], ['network.penalties.executed', minipoolAddress, block]);

    let maxPenaltyRate = await lqgMinipoolPenalty.getMaxPenaltyRate();
    let penaltyThreshold = await lqgDAOProtocolSettingsNetwork.getNodePenaltyThreshold();

    // Get submission details
    function getSubmissionDetails() {
        return Promise.all([
            lqgStorage.getBool(nodeSubmissionKey),
            lqgStorage.getUint(submissionCountKey),
            lqgStorage.getBool(executionKey),
        ]).then(
            ([nodeSubmitted, count, executed]) =>
                ({ nodeSubmitted, count, executed }),
        );
    }

    function getPenalty() {
        return Promise.all([
            lqgMinipoolPenalty.getPenaltyRate(minipoolAddress),
            lqgStorage.getUint(penaltyKey),
        ]).then(
            ([penaltyRate, penaltyCount]) =>
                ({ penaltyRate, penaltyCount }),
        );
    }

    // Get initial submission details
    let [submission1, penalty1] = await Promise.all([
        getSubmissionDetails(),
        getPenalty(),
    ]);

    // Submit penalties
    if (submission1.executed) {
        await shouldRevert(lqgNetworkPenalties.connect(txOptions.from).submitPenalty(minipoolAddress, block, txOptions), 'Did not revert on already executed penalty', 'Penalty already applied for this block');
    } else {
        await lqgNetworkPenalties.connect(txOptions.from).submitPenalty(minipoolAddress, block, txOptions);
    }

    // Get updated submission details & penalties
    let [submission2, penalty2] = await Promise.all([
        getSubmissionDetails(),
        getPenalty(),
    ]);

    // Check if penalties should be updated
    let expectedUpdatedPenalty = ('1'.ether * submission2.count / trustedNodeCount) >= penaltyThreshold;

    // Check submission details
    assert.equal(submission1.nodeSubmitted, false, 'Incorrect initial node submitted status');

    if (!submission1.executed) {
        assert.equal(submission2.nodeSubmitted, true, 'Incorrect updated node submitted status');
        assertBN.equal(submission2.count, submission1.count + 1n, 'Incorrect updated submission count');
    }

    // Check penalty
    if (!submission1.executed && expectedUpdatedPenalty) {
        assert.equal(submission2.executed, true, 'Penalty not executed');
        assertBN.equal(penalty2.penaltyCount, penalty1.penaltyCount + 1n, 'Penalty count not updated');

        // Unless we hit max penalty, expect to see an increase in the penalty rate
        if (penalty1.penaltyRate < maxPenaltyRate && penalty2.penaltyCount >= 3n) {
            assertBN.isAbove(penalty2.penaltyRate, penalty1.penaltyRate, 'Penalty rate did not increase');
        }
    } else if (!expectedUpdatedPenalty) {
        assert.equal(submission2.executed, false, 'Penalty executed');
    }
}
