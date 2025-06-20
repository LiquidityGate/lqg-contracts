import {
    LQGDepositPool,
    LQGDAOProtocolSettingsDeposit,
    LQGMinipoolQueue,
    LQGDAOProtocolSettingsMinipool,
    LQGVault,
    LQGMinipoolDelegate,
} from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';
import { BigMin } from '../_helpers/bigmath';

const hre = require('hardhat');
const ethers = hre.ethers;

// Assign deposits to minipools
export async function assignDepositsV2(txOptions) {
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
        maxSocialisedAssignments,
        minipoolQueueLength,
        fullMinipoolQueueLength, halfMinipoolQueueLength, emptyMinipoolQueueLength,
        fullDepositUserAmount, halfDepositUserAmount, emptyDepositUserAmount,
    ] = await Promise.all([
        lqgVault.balanceOf("lqgDepositPool"),
        lqgDAOProtocolSettingsDeposit.getMaximumDepositAssignments(),
        lqgDAOProtocolSettingsDeposit.getMaximumDepositSocialisedAssignments(),
        lqgMinipoolQueue.getLength(),
        lqgMinipoolQueue.getLengthLegacy(1), lqgMinipoolQueue.getLengthLegacy(2), lqgMinipoolQueue.getLengthLegacy(3),
        lqgDAOProtocolSettingsMinipool.getDepositUserAmount(1), lqgDAOProtocolSettingsMinipool.getDepositUserAmount(2), lqgDAOProtocolSettingsMinipool.getDepositUserAmount(3),
    ]);

    // Get queued minipool capacities
    let minipoolCapacities = [];
    for (let i = 0; i < halfMinipoolQueueLength; ++i)  minipoolCapacities.push(halfDepositUserAmount);
    for (let i = 0; i < fullMinipoolQueueLength; ++i)  minipoolCapacities.push(fullDepositUserAmount);
    for (let i = 0; i < emptyMinipoolQueueLength; ++i) minipoolCapacities.push(emptyDepositUserAmount);

    // Get expected deposit assignment parameters
    let expectedDepositAssignments = 0n;
    let expectedEthAssigned = '0'.ether;
    let expectedNodeBalanceUsed = '0'.ether;
    let depositBalanceRemaining = depositPoolBalance;
    let depositAssignmentsRemaining = maxDepositAssignments;

    while (minipoolCapacities.length > 0 && depositBalanceRemaining >= minipoolCapacities[0] && depositAssignmentsRemaining > 0) {
        let capacity = minipoolCapacities.shift();
        ++expectedDepositAssignments;
        expectedEthAssigned = expectedEthAssigned.add(capacity);
        depositBalanceRemaining = depositBalanceRemaining.sub(capacity);
        --depositAssignmentsRemaining;
    }

    // No legacy deposits
    if (expectedDepositAssignments === 0n) {
        let scalingCount = maxSocialisedAssignments;
        let totalEthCount = depositPoolBalance / '31'.ether;
        expectedDepositAssignments = BigMin(scalingCount, totalEthCount, maxDepositAssignments, minipoolQueueLength);
        expectedEthAssigned = '31'.ether * expectedDepositAssignments;

        let indices = [...Array(Number(expectedDepositAssignments)).keys()];
        let addressesInQueue = await Promise.all(indices.map(i => lqgMinipoolQueue.getMinipoolAt(i)));
        let minipoolsInQueue = await Promise.all(addressesInQueue.map(a => LQGMinipoolDelegate.at(a)));
        let topUpValues = await Promise.all(minipoolsInQueue.map(m => m.getNodeTopUpValue()))
        expectedNodeBalanceUsed = topUpValues.reduce((p, c) => p + c, expectedNodeBalanceUsed);
    }

    // Get balances
    function getBalances() {
        return Promise.all([
            lqgDepositPool.getBalance(),
            lqgDepositPool.getNodeBalance(),
            ethers.provider.getBalance(lqgVault.target),
        ]).then(
            ([depositPoolEth, depositPoolNodeEth, vaultEth]) =>
            ({depositPoolEth, depositPoolNodeEth, vaultEth})
        );
    }

    // Get minipool queue details
    function getMinipoolQueueDetails() {
        return Promise.all([
            lqgMinipoolQueue.getTotalLength(),
            lqgMinipoolQueue.getTotalCapacity(),
        ]).then(
            ([totalLength, totalCapacity]) =>
            ({totalLength, totalCapacity})
        );
    }

    // Get initial balances & minipool queue details
    let [balances1, queue1] = await Promise.all([
        getBalances(),
        getMinipoolQueueDetails(),
    ]);

    // Assign deposits
    await lqgDepositPool.connect(txOptions.from).assignDeposits(txOptions);

    // Get updated balances & minipool queue details
    let [balances2, queue2] = await Promise.all([
        getBalances(),
        getMinipoolQueueDetails(),
    ]);

    // Check balances
    assertBN.equal(balances2.depositPoolEth, balances1.depositPoolEth - expectedEthAssigned, 'Incorrect updated deposit pool ETH balance');
    assertBN.equal(balances2.depositPoolNodeEth, balances1.depositPoolNodeEth - expectedNodeBalanceUsed, 'Incorrect updated deposit pool node ETH balance');
    assertBN.equal(balances2.vaultEth, balances1.vaultEth - expectedEthAssigned, 'Incorrect updated vault ETH balance');

    // Check minipool queues
    assertBN.equal(queue2.totalLength, queue1.totalLength - BigInt(expectedDepositAssignments), 'Incorrect updated minipool queue length');
    assertBN.equal(queue2.totalCapacity, queue1.totalCapacity - expectedEthAssigned, 'Incorrect updated minipool queue capacity');
}
