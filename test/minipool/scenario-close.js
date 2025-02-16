import { LQGNodeManager, LQGNodeStaking } from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';

const hre = require('hardhat');
const ethers = hre.ethers;

// Close a minipool
export async function close(minipool, txOptions) {
    // Load contracts
    const lqgNodeManager = await LQGNodeManager.deployed();
    const lqgNodeStaking = await LQGNodeStaking.deployed();

    // Get parameters
    let nodeAddress = await minipool.getNodeAddress();
    let nodeWithdrawalAddress = await lqgNodeManager.getNodeWithdrawalAddress(nodeAddress);

    // Get initial node balance & minipool balances
    let [nodeBalance1, ethMatched1, minipoolBalance, userDepositBalance] = await Promise.all([
        ethers.provider.getBalance(nodeWithdrawalAddress),
        lqgNodeStaking.getNodeETHMatched(txOptions.from),
        ethers.provider.getBalance(minipool.target),
        minipool.getUserDepositBalance(),
    ]);

    // Set gas price
    let gasPrice = '20'.gwei;
    txOptions.gasPrice = gasPrice;

    // Close & get tx fee
    let tx = await minipool.connect(txOptions.from).close(txOptions);
    let txReceipt = await tx.wait();
    let txFee = gasPrice * txReceipt.gasUsed;

    // Get updated node balance & minipool contract code
    let [nodeBalance2, ethMatched2] = await Promise.all([
        ethers.provider.getBalance(nodeWithdrawalAddress),
        lqgNodeStaking.getNodeETHMatched(txOptions.from),
    ]);

    // Check balances
    let expectedNodeBalance = nodeBalance1 + minipoolBalance;
    if (nodeWithdrawalAddress === nodeAddress) expectedNodeBalance = expectedNodeBalance - txFee;
    assertBN.equal(nodeBalance2, expectedNodeBalance, 'Incorrect updated node nETH balance');

    // Expect node's ETH matched to be decreased by userDepositBalance
    assertBN.equal(ethMatched1 - ethMatched2, userDepositBalance, 'Incorrect ETH matched');
}

