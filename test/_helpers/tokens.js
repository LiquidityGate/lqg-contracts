import { LQGTokenDummyRPL, LQGTokenRETH, LQGTokenRPL } from '../_utils/artifacts';

// Get the RPL balance of an address
export async function getRplBalance(address) {
    const lqgTokenRPL = await LQGTokenRPL.deployed();
    return lqgTokenRPL.balanceOf(address);
}

// Get the rETH balance of an address
export async function getRethBalance(address) {
    const lqgTokenRETH = await LQGTokenRETH.deployed();
    return lqgTokenRETH.balanceOf(address);
}

// Get the current rETH exchange rate
export async function getRethExchangeRate() {
    const lqgTokenRETH = await LQGTokenRETH.deployed();
    return lqgTokenRETH.getExchangeRate();
}

// Get the current rETH collateral rate
export async function getRethCollateralRate() {
    const lqgTokenRETH = await LQGTokenRETH.deployed();
    return lqgTokenRETH.getCollateralRate();
}

// Get the current rETH token supply
export async function getRethTotalSupply() {
    const lqgTokenRETH = await LQGTokenRETH.deployed();
    return lqgTokenRETH.totalSupply();
}

// Mint RPL to an address
export async function mintRPL(owner, toAddress, amount) {
    // Load contracts
    const [lqgTokenDummyRPL, lqgTokenRPL] = await Promise.all([
        LQGTokenDummyRPL.deployed(),
        LQGTokenRPL.deployed(),
    ]);

    // Mint dummy RPL to address
    await lqgTokenDummyRPL.connect(owner).mint(toAddress, amount);

    // Swap dummy RPL for RPL
    await lqgTokenDummyRPL.connect(toAddress).approve(lqgTokenRPL.target, amount);
    await lqgTokenRPL.connect(toAddress).swapTokens(amount);
}

// Approve RPL to be spend by an address
export async function approveRPL(spender, amount, txOptions) {
    const lqgTokenRPL = await LQGTokenRPL.deployed();
    await lqgTokenRPL.connect(txOptions.from).approve(spender, amount, txOptions);
}

export async function depositExcessCollateral(txOptions) {
    const lqgTokenRETH = await LQGTokenRETH.deployed();
    await lqgTokenRETH.connect(txOptions.from).depositExcessCollateral(txOptions);
}
