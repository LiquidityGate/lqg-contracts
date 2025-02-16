import {
    LQGMinipoolBondReducer,
    LQGMinipoolManager,
    LQGNodeDeposit,
    LQGNodeStaking,
} from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';

// Reduce bonding amount of a minipool
export async function reduceBond(minipool, txOptions = null) {
    const lqgNodeDeposit = await LQGNodeDeposit.deployed();
    const lqgNodeStaking = await LQGNodeStaking.deployed();
    const lqgMinipoolBondReducer = await LQGMinipoolBondReducer.deployed();
    const lqgMinipoolManager = await LQGMinipoolManager.deployed();
    const node = await minipool.getNodeAddress();

    const newBond = await lqgMinipoolBondReducer.getReduceBondValue(minipool.target);
    const prevBond = await minipool.getNodeDepositBalance();

    // Get minipool balances
    function getMinipoolBalances() {
        return Promise.all([
            minipool.getNodeDepositBalance(),
            minipool.getUserDepositBalance(),
            lqgNodeDeposit.getNodeDepositCredit(node),
            lqgNodeStaking.getNodeETHMatched(node),
        ]).then(
            ([nodeDepositBalance, userDepositBalance, nodeDepositCredit, ethMatched]) =>
                ({ nodeDepositBalance, userDepositBalance, nodeDepositCredit, ethMatched }),
        );
    }

    // Get node details
    function getNodeDetails() {
        return Promise.all([
            lqgMinipoolManager.getNodeStakingMinipoolCountBySize(node, prevBond),
            lqgMinipoolManager.getNodeStakingMinipoolCountBySize(node, newBond),
            lqgMinipoolManager.getNodeStakingMinipoolCount(node),
        ]).then(
            ([prevBondCount, newBondCount, totalCount]) =>
                ({ prevBondCount, newBondCount, totalCount }),
        );
    }

    // Get new bond amount
    const amount = await lqgMinipoolBondReducer.getReduceBondValue(minipool.target);

    // Record balances before and after calling reduce bond function
    const balances1 = await getMinipoolBalances();
    const details1 = await getNodeDetails();
    await minipool.connect(txOptions.from).reduceBondAmount(txOptions);
    const balances2 = await getMinipoolBalances();
    const details2 = await getNodeDetails();

    // Verify results
    const delta = balances1.nodeDepositBalance - amount;
    assertBN.equal(balances2.nodeDepositBalance, delta);
    assertBN.equal(balances2.userDepositBalance - balances1.userDepositBalance, delta);
    assertBN.equal(balances2.nodeDepositCredit - balances1.nodeDepositCredit, delta);
    assertBN.equal(balances2.ethMatched - balances1.ethMatched, delta);

    // Overall number of minipools shouldn't change
    assertBN.equal(details2.totalCount, details1.totalCount);
    // Prev bond amount should decrement by 1
    assertBN.equal(details1.prevBondCount - details2.prevBondCount, 1n);
    // New bond amount should increment by 1
    assertBN.equal(details2.newBondCount - details1.newBondCount, 1n);
}
