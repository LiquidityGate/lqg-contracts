import { LQGTokenRETH } from '../../test/_utils/artifacts';
import { assertBN } from '../_helpers/bn';

// Burn rETH for ETH
export async function burnReth(amount, txOptions) {
    // Load contracts
    const lqgTokenRETH = await LQGTokenRETH.deployed();

    // Get balances
    function getBalances() {
        return Promise.all([
            lqgTokenRETH.totalSupply(),
            lqgTokenRETH.balanceOf(txOptions.from),
            ethers.provider.getBalance(txOptions.from),
        ]).then(
            ([tokenSupply, userTokenBalance, userEthBalance]) =>
                ({ tokenSupply, userTokenBalance, userEthBalance }),
        );
    }

    // Get initial balances
    let balances1 = await getBalances();

    // Set gas price
    let gasPrice = '20'.gwei;
    txOptions.gasPrice = gasPrice;

    // Burn tokens & get tx fee
    let tx = await lqgTokenRETH.connect(txOptions.from).burn(amount, txOptions);
    const txReceipt = await tx.wait();
    let txFee = gasPrice * txReceipt.gasUsed;

    // Get updated balances
    let balances2 = await getBalances();

    // Calculate values
    let burnAmount = amount;
    let expectedEthTransferred = await lqgTokenRETH.getEthValue(burnAmount);

    // Check balances
    assertBN.equal(balances2.tokenSupply, balances1.tokenSupply - burnAmount, 'Incorrect updated token supply');
    assertBN.equal(balances2.userTokenBalance, balances1.userTokenBalance - burnAmount, 'Incorrect updated user token balance');
    assertBN.equal(balances2.userEthBalance, balances1.userEthBalance + expectedEthTransferred - txFee, 'Incorrect updated user ETH balance');
}
