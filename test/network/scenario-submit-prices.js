import { LQGDAONodeTrusted, LQGNetworkPrices, LQGStorage } from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';
import * as assert from 'assert';

const hre = require('hardhat');
const ethers = hre.ethers;

// Submit network prices
export async function submitPrices(block, slotTimestamp, rplPrice, txOptions) {
    // Load contracts
    const [
        lqgDAONodeTrusted,
        lqgNetworkPrices,
        lqgStorage,
    ] = await Promise.all([
        LQGDAONodeTrusted.deployed(),
        LQGNetworkPrices.deployed(),
        LQGStorage.deployed(),
    ]);

    // Get parameters
    let trustedNodeCount = await lqgDAONodeTrusted.getMemberCount();

    // Get submission keys
    let nodeSubmissionKey = ethers.solidityPackedKeccak256(
        ['string', 'address', 'uint256', 'uint256', 'uint256'],
        ['network.prices.submitted.node.key', txOptions.from.address, block, slotTimestamp, rplPrice],
    );
    let submissionCountKey = ethers.solidityPackedKeccak256(
        ['string', 'uint256', 'uint256', 'uint256'],
        ['network.prices.submitted.count', block, slotTimestamp, rplPrice],
    );

    // Get submission details
    function getSubmissionDetails() {
        return Promise.all([
            lqgStorage.getBool(nodeSubmissionKey),
            lqgStorage.getUint(submissionCountKey),
        ]).then(
            ([nodeSubmitted, count]) =>
                ({ nodeSubmitted, count }),
        );
    }

    // Get prices
    function getPrices() {
        return Promise.all([
            lqgNetworkPrices.getPricesBlock(),
            lqgNetworkPrices.getRPLPrice(),
        ]).then(
            ([block, rplPrice]) =>
                ({ block, rplPrice }),
        );
    }

    // Get initial submission details
    let submission1 = await getSubmissionDetails();

    // Submit prices
    await lqgNetworkPrices.connect(txOptions.from).submitPrices(block, slotTimestamp, rplPrice, txOptions);

    // Get updated submission details & prices
    let [submission2, prices] = await Promise.all([
        getSubmissionDetails(),
        getPrices(),
    ]);

    // Check if prices should be updated
    let expectUpdatedPrices = (submission2.count * 2n) > trustedNodeCount;

    // Check submission details
    assert.equal(submission1.nodeSubmitted, false, 'Incorrect initial node submitted status');
    assert.equal(submission2.nodeSubmitted, true, 'Incorrect updated node submitted status');
    assertBN.equal(submission2.count, submission1.count + 1n, 'Incorrect updated submission count');

    // Check prices
    if (expectUpdatedPrices) {
        assertBN.equal(prices.block, block, 'Incorrect updated network prices block');
        assertBN.equal(prices.rplPrice, rplPrice, 'Incorrect updated network RPL price');
    } else {
        assertBN.notEqual(prices.block, block, 'Incorrectly updated network prices block');
        assertBN.notEqual(prices.rplPrice, rplPrice, 'Incorrectly updated network RPL price');
    }
}

// Execute price update
export async function executeUpdatePrices(block, slotTimestamp, rplPrice, txOptions) {
    // Load contracts
    const lqgNetworkPrices = await LQGNetworkPrices.deployed();

    // Get prices
    function getPrices() {
        return Promise.all([
            lqgNetworkPrices.getPricesBlock(),
            lqgNetworkPrices.getRPLPrice(),
        ]).then(
            ([block, rplPrice]) =>
                ({ block, rplPrice }),
        );
    }

    // Submit prices
    await lqgNetworkPrices.connect(txOptions.from).executeUpdatePrices(block, slotTimestamp, rplPrice, txOptions);

    // Get updated submission details & prices
    let prices = await getPrices();

    // Check the prices
    assertBN.equal(prices.block, block, 'Incorrect updated network prices block');
    assertBN.equal(prices.rplPrice, rplPrice, 'Incorrect updated network RPL price');
}
