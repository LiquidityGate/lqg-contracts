import { LQGDepositPool } from '../_utils/artifacts';

// Get the deposit pool excess ETH balance
export async function getDepositExcessBalance() {
    const lqgDepositPool = await LQGDepositPool.deployed();
    return lqgDepositPool.getExcessBalance.call();
}

// Make a deposit
export async function userDeposit(txOptions) {
    const lqgDepositPool = await LQGDepositPool.deployed();
    await lqgDepositPool.connect(txOptions.from).deposit(txOptions);
}

// Assign deposits
export async function assignDeposits(txOptions) {
    const lqgDepositPool = await LQGDepositPool.deployed();
    await lqgDepositPool.assignDeposits(txOptions);
}

