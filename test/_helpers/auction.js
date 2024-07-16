import { LQGAuctionManager } from '../_utils/artifacts';

// Get lot start/end blocks
export async function getLotStartBlock(lotIndex) {
    const lqgAuctionManager = await LQGAuctionManager.deployed();
    return lqgAuctionManager.getLotStartBlock(lotIndex);
}

export async function getLotEndBlock(lotIndex) {
    const lqgAuctionManager = await LQGAuctionManager.deployed();
    return lqgAuctionManager.getLotEndBlock(lotIndex);
}

// Get lot price at a block
export async function getLotPriceAtBlock(lotIndex, block) {
    const lqgAuctionManager = await LQGAuctionManager.deployed();
    return lqgAuctionManager.getLotPriceAtBlock(lotIndex, block);
}

// Create a new lot for auction
export async function auctionCreateLot(txOptions) {
    const lqgAuctionManager = await LQGAuctionManager.deployed();
    await lqgAuctionManager.connect(txOptions.from).createLot(txOptions);
}

// Place a bid on a lot
export async function auctionPlaceBid(lotIndex, txOptions) {
    const lqgAuctionManager = await LQGAuctionManager.deployed();
    await lqgAuctionManager.connect(txOptions.from).placeBid(lotIndex, txOptions);
}

