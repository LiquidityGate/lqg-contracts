import { LQGAuctionManager } from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';
import * as assert from 'assert';

// Recover unclaimed RPL from a lot
export async function recoverUnclaimedRPL(lotIndex, txOptions) {
    // Load contracts
    const lqgAuctionManager = await LQGAuctionManager.deployed();

    // Get auction contract details
    function getContractDetails() {
        return Promise.all([
            lqgAuctionManager.getAllottedRPLBalance(),
            lqgAuctionManager.getRemainingRPLBalance(),
        ]).then(
            ([allottedRplBalance, remainingRplBalance]) =>
                ({ allottedRplBalance, remainingRplBalance }),
        );
    }

    // Get lot details
    function getLotDetails() {
        return Promise.all([
            lqgAuctionManager.getLotRPLRecovered(lotIndex),
            lqgAuctionManager.getLotRemainingRPLAmount(lotIndex),
        ]).then(
            ([rplRecovered, remainingRplAmount]) =>
                ({ rplRecovered, remainingRplAmount }),
        );
    }

    // Get initial details
    let [details1, lot1] = await Promise.all([
        getContractDetails(),
        getLotDetails(),
    ]);

    // Recover RPL
    await lqgAuctionManager.connect(txOptions.from).recoverUnclaimedRPL(lotIndex, txOptions);

    // Get updated details
    let [details2, lot2] = await Promise.all([
        getContractDetails(),
        getLotDetails(),
    ]);

    // Check details
    assertBN.equal(details2.allottedRplBalance, details1.allottedRplBalance - lot1.remainingRplAmount, 'Incorrect updated contract allotted RPL balance');
    assertBN.equal(details2.remainingRplBalance, details1.remainingRplBalance + lot1.remainingRplAmount, 'Incorrect updated contract remaining RPL balance');
    assert.equal(lot2.rplRecovered, true, 'Incorrect updated lot RPL recovered status');
}

