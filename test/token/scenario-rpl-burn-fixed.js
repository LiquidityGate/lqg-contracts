import { LQGTokenDummyRPL, LQGTokenRPL } from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';

// Burn current fixed supply RPL for new RPL
export async function burnFixedRPL(amount, txOptions) {
    // Load contracts
    const lqgTokenRPL = await LQGTokenRPL.deployed();
    const lqgTokenDummyRPL = await LQGTokenDummyRPL.deployed();

    // Get balances
    function getBalances() {
        return Promise.all([
            lqgTokenDummyRPL.balanceOf(txOptions.from),
            lqgTokenRPL.totalSupply(),
            lqgTokenRPL.balanceOf(txOptions.from),
            lqgTokenDummyRPL.balanceOf(lqgTokenRPL.target),
            lqgTokenRPL.balanceOf(lqgTokenRPL.target),
        ]).then(
            ([rplFixedUserBalance, rplTokenSupply, rplUserBalance, rplContractBalanceOfFixedSupply, rplContractBalanceOfSelf]) =>
                ({
                    rplFixedUserBalance,
                    rplTokenSupply,
                    rplUserBalance,
                    rplContractBalanceOfFixedSupply,
                    rplContractBalanceOfSelf,
                }),
        );
    }

    // Get initial balances
    let balances1 = await getBalances();

    // Burn tokens & get tx fee
    await lqgTokenRPL.connect(txOptions.from).swapTokens(amount, txOptions);

    // Get updated balances
    let balances2 = await getBalances();

    // Calculate values
    let mintAmount = BigInt(amount);

    // Check balances
    assertBN.equal(balances2.rplUserBalance, balances1.rplUserBalance + mintAmount, 'Incorrect updated user token balance');
    assertBN.equal(balances2.rplContractBalanceOfSelf, balances1.rplContractBalanceOfSelf - mintAmount, 'RPL contract has not sent the RPL to the user address');
}
