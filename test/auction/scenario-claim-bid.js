import { LQGAuctionManager, LQGTokenRPL, LQGVault } from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';

// Claim RPL from a lot
export async function claimBid(lotIndex, txOptions) {

    // Load contracts
    const [
        lqgAuctionManager,
        lqgTokenRPL,
        lqgVault,
    ] = await Promise.all([
        LQGAuctionManager.deployed(),
        LQGTokenRPL.deployed(),
        LQGVault.deployed(),
    ]);

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
    function getLotDetails(bidderAddress) {
        return Promise.all([
            lqgAuctionManager.getLotAddressBidAmount(lotIndex, bidderAddress),
            lqgAuctionManager.getLotCurrentPrice(lotIndex),
        ]).then(
            ([addressBidAmount, currentPrice]) =>
                ({ addressBidAmount, currentPrice }),
        );
    }

    // Get balances
    function getBalances(bidderAddress) {
        return Promise.all([
            lqgTokenRPL.balanceOf(bidderAddress),
            lqgTokenRPL.balanceOf(lqgVault.target),
            lqgVault.balanceOfToken('lqgAuctionManager', lqgTokenRPL.target),
        ]).then(
            ([bidderRpl, vaultRpl, contractRpl]) =>
                ({ bidderRpl, vaultRpl, contractRpl }),
        );
    }

    // Get initial details & balances
    let [details1, lot1, balances1] = await Promise.all([
        getContractDetails(),
        getLotDetails(txOptions.from),
        getBalances(txOptions.from),
    ]);

    // Claim RPL
    await lqgAuctionManager.connect(txOptions.from).claimBid(lotIndex, txOptions);

    // Get updated details & balances
    let [details2, lot2, balances2] = await Promise.all([
        getContractDetails(),
        getLotDetails(txOptions.from),
        getBalances(txOptions.from),
    ]);

    // Get expected values
    const calcBase = '1'.ether;
    const expectedRplAmount = calcBase * lot1.addressBidAmount / lot1.currentPrice;

    // Check details
    assertBN.equal(details2.allottedRplBalance, details1.allottedRplBalance - expectedRplAmount, 'Incorrect updated contract allotted RPL balance');
    assertBN.equal(details2.remainingRplBalance, details1.remainingRplBalance, 'Contract remaining RPL balance updated and should not have');
    assertBN.equal(lot2.addressBidAmount, 0, 'Incorrect updated address bid amount');

    // Check balances
    assertBN.equal(balances2.bidderRpl, balances1.bidderRpl + expectedRplAmount, 'Incorrect updated address RPL balance');
    assertBN.equal(balances2.contractRpl, balances1.contractRpl - expectedRplAmount, 'Incorrect updated auction contract RPL balance');
    assertBN.equal(balances2.vaultRpl, balances1.vaultRpl - expectedRplAmount, 'Incorrect updated vault RPL balance');
}

