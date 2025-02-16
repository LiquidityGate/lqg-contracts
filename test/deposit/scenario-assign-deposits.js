import {
    LQGDAOProtocolSettingsDeposit,
    LQGDAOProtocolSettingsMinipool,
    LQGDepositPool,
    LQGMinipoolQueue,
    LQGVault,
} from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';

// Assign deposits to minipools
export async function assignDeposits(txOptions) {
    // Load contracts
    const [
        lqgDepositPool,
        lqgDAOProtocolSettingsDeposit,
        lqgMinipoolQueue,
        lqgDAOProtocolSettingsMinipool,
        lqgVault,
    ] = await Promise.all([
        LQGDepositPool.deployed(),
        LQGDAOProtocolSettingsDeposit.deployed(),
        LQGMinipoolQueue.deployed(),
        LQGDAOProtocolSettingsMinipool.deployed(),
        LQGVault.deployed(),
    ]);

    // Get parameters
    let [
        depositPoolBalance,
        maxDepositAssignments,
        fullMinipoolQueueLength, halfMinipoolQueueLength, emptyMinipoolQueueLength,
        fullDepositUserAmount, halfDepositUserAmount, emptyDepositUserAmount,
    ] = await Promise.all([
        lqgDepositPool.getBalance.call(),
        lqgDAOProtocolSettingsDeposit.getMaximumDepositAssignments.call(),
        lqgMinipoolQueue.getLength.call(1), lqgMinipoolQueue.getLength.call(2), lqgMinipoolQueue.getLength.call(3),
        lqgDAOProtocolSettingsMinipool.getDepositUserAmount(1), lqgDAOProtocolSettingsMinipool.getDepositUserAmount(2), lqgDAOProtocolSettingsMinipool.getDepositUserAmount(3),
    ]);

    // Get queued minipool capacities
    let minipoolCapacities = [];
    for (let i = 0; i < halfMinipoolQueueLength; ++i) minipoolCapacities.push(halfDepositUserAmount);
    for (let i = 0; i < fullMinipoolQueueLength; ++i) minipoolCapacities.push(fullDepositUserAmount);
    for (let i = 0; i < emptyMinipoolQueueLength; ++i) minipoolCapacities.push(emptyDepositUserAmount);

    // Get expected deposit assignment parameters
    let expectedDepositAssignments = 0;
    let expectedEthAssigned = 0n;
    let depositBalanceRemaining = depositPoolBalance;
    let depositAssignmentsRemaining = maxDepositAssignments;
    while (minipoolCapacities.length > 0 && depositBalanceRemaining.gte(minipoolCapacities[0]) && depositAssignmentsRemaining > 0) {
        let capacity = minipoolCapacities.shift();
        ++expectedDepositAssignments;
        expectedEthAssigned = expectedEthAssigned.add(capacity);
        depositBalanceRemaining = depositBalanceRemaining.sub(capacity);
        --depositAssignmentsRemaining;
    }

    // Get balances
    function getBalances() {
        return Promise.all([
            lqgDepositPool.getBalance.call(),
            web3.eth.getBalance(lqgVault.address).then(value => value.BN),
        ]).then(
            ([depositPoolEth, vaultEth]) =>
                ({ depositPoolEth, vaultEth }),
        );
    }

    // Get minipool queue details
    function getMinipoolQueueDetails() {
        return Promise.all([
            lqgMinipoolQueue.getTotalLength.call(),
            lqgMinipoolQueue.getTotalCapacity.call(),
        ]).then(
            ([totalLength, totalCapacity]) =>
                ({ totalLength, totalCapacity }),
        );
    }

    // Get initial balances & minipool queue details
    let [balances1, queue1] = await Promise.all([
        getBalances(),
        getMinipoolQueueDetails(),
    ]);

    // Assign deposits
    await lqgDepositPool.assignDeposits(txOptions);

    // Get updated balances & minipool queue details
    let [balances2, queue2] = await Promise.all([
        getBalances(),
        getMinipoolQueueDetails(),
    ]);

    // Check balances
    assertBN.equal(balances2.depositPoolEth, balances1.depositPoolEth.sub(expectedEthAssigned), 'Incorrect updated deposit pool ETH balance');
    assertBN.equal(balances2.vaultEth, balances1.vaultEth.sub(expectedEthAssigned), 'Incorrect updated vault ETH balance');

    // Check minipool queues
    assertBN.equal(queue2.totalLength, queue1.totalLength.sub(expectedDepositAssignments.BN), 'Incorrect updated minipool queue length');
    assertBN.equal(queue2.totalCapacity, queue1.totalCapacity.sub(expectedEthAssigned), 'Incorrect updated minipool queue capacity');
}
