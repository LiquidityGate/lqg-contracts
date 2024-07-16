import { LQGAuctionManager, LQGDAOProtocolSettingsAuction, LQGNetworkPrices } from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';
import * as assert from 'assert';

// Create a new lot for auction
export async function createLot(txOptions) {

    // Load contracts
    const [
        lqgAuctionManager,
        lqgAuctionSettings,
        lqgNetworkPrices,
    ] = await Promise.all([
        LQGAuctionManager.deployed(),
        LQGDAOProtocolSettingsAuction.deployed(),
        LQGNetworkPrices.deployed(),
    ]);

    // Get parameters
    const [
        lotMaxEthValue,
        lotDuration,
        startPriceRatio,
        reservePriceRatio,
        rplPrice,
    ] = await Promise.all([
        lqgAuctionSettings.getLotMaximumEthValue(),
        lqgAuctionSettings.getLotDuration(),
        lqgAuctionSettings.getStartingPriceRatio(),
        lqgAuctionSettings.getReservePriceRatio(),
        lqgNetworkPrices.getRPLPrice(),
    ]);

    // Get auction contract details
    function getContractDetails() {
        return Promise.all([
            lqgAuctionManager.getTotalRPLBalance(),
            lqgAuctionManager.getAllottedRPLBalance(),
            lqgAuctionManager.getRemainingRPLBalance(),
            lqgAuctionManager.getLotCount(),
        ]).then(
            ([totalRplBalance, allottedRplBalance, remainingRplBalance, lotCount]) =>
                ({ totalRplBalance, allottedRplBalance, remainingRplBalance, lotCount }),
        );
    }

    // Get lot details
    function getLotDetails(lotIndex) {
        return Promise.all([
            lqgAuctionManager.getLotExists(lotIndex),
            lqgAuctionManager.getLotStartBlock(lotIndex),
            lqgAuctionManager.getLotEndBlock(lotIndex),
            lqgAuctionManager.getLotStartPrice(lotIndex),
            lqgAuctionManager.getLotReservePrice(lotIndex),
            lqgAuctionManager.getLotTotalRPLAmount(lotIndex),
            lqgAuctionManager.getLotCurrentPrice(lotIndex),
            lqgAuctionManager.getLotClaimedRPLAmount(lotIndex),
            lqgAuctionManager.getLotRemainingRPLAmount(lotIndex),
            lqgAuctionManager.getLotIsCleared(lotIndex),
        ]).then(
            ([exists, startBlock, endBlock, startPrice, reservePrice, totalRpl, currentPrice, claimedRpl, remainingRpl, isCleared]) =>
                ({
                    exists,
                    startBlock,
                    endBlock,
                    startPrice,
                    reservePrice,
                    totalRpl,
                    currentPrice,
                    claimedRpl,
                    remainingRpl,
                    isCleared,
                }),
        );
    }

    // Get initial contract details
    let details1 = await getContractDetails();

    // Create lot
    await lqgAuctionManager.connect(txOptions.from).createLot(txOptions);

    // Get updated contract details
    let [details2, lot] = await Promise.all([
        getContractDetails(),
        getLotDetails(details1.lotCount),
    ]);

    // Get expected values
    const calcBase = '1'.ether;
    const lotMaxRplAmount = calcBase * lotMaxEthValue / rplPrice;
    const expectedRemainingRplBalance = (details1.remainingRplBalance > lotMaxRplAmount) ? (details1.remainingRplBalance - lotMaxRplAmount) : '0'.ether;
    const expectedLotRplAmount = (details1.remainingRplBalance < lotMaxRplAmount) ? details1.remainingRplBalance : lotMaxRplAmount;

    // Check contract details
    assertBN.equal(details2.totalRplBalance, details1.totalRplBalance, 'Total RPL balance updated and should not have');
    assertBN.equal(details2.remainingRplBalance, expectedRemainingRplBalance, 'Incorrect updated remaining RPL balance');
    assertBN.equal(details2.totalRplBalance, details2.allottedRplBalance + details2.remainingRplBalance, 'Incorrect updated RPL balances');
    assertBN.equal(details2.lotCount, details1.lotCount + 1n, 'Incorrect updated lot count');

    // Check lot details
    assert.equal(lot.exists, true, 'Incorrect lot exists status');
    assertBN.equal(lot.endBlock, lot.startBlock + lotDuration, 'Incorrect lot start/end blocks');
    assertBN.equal(lot.startPrice, rplPrice * startPriceRatio / calcBase, 'Incorrect lot starting price');
    assertBN.equal(lot.reservePrice, rplPrice * reservePriceRatio / calcBase, 'Incorrect lot reserve price');
    assertBN.equal(lot.totalRpl, expectedLotRplAmount, 'Incorrect lot total RPL amount');
    assertBN.equal(lot.currentPrice, lot.startPrice, 'Incorrect lot current price');
    assertBN.equal(lot.claimedRpl, 0, 'Incorrect lot claimed RPL amount');
    assertBN.equal(lot.remainingRpl, lot.totalRpl, 'Incorrect lot remaining RPL amount');
    assert.equal(lot.isCleared, false, 'Incorrect lot cleared status');
}

