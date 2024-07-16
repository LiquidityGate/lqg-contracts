import { LQGNodeManager } from '../_utils/artifacts';
import { assertBN } from '../_helpers/bn';
import * as assert from 'assert';

// Register a node
export async function register(timezoneLocation, txOptions) {
    // Load contracts
    const lqgNodeManager = await LQGNodeManager.deployed();

    // Get node details
    function getNodeDetails(nodeAddress) {
        return Promise.all([
            lqgNodeManager.getNodeExists(nodeAddress),
            lqgNodeManager.getNodeTimezoneLocation(nodeAddress),
        ]).then(
            ([exists, timezoneLocation]) =>
                ({ exists, timezoneLocation }),
        );
    }

    // Get initial node index
    let nodeCount1 = await lqgNodeManager.getNodeCount();

    // Register
    await lqgNodeManager.connect(txOptions.from).registerNode(timezoneLocation, txOptions);

    // Get updated node index & node details
    let nodeCount2 = await lqgNodeManager.getNodeCount();
    let [lastNodeAddress, details] = await Promise.all([
        lqgNodeManager.getNodeAt(nodeCount2 - 1n),
        getNodeDetails(txOptions.from.address),
    ]);

    // Check details
    assertBN.equal(nodeCount2, nodeCount1 + 1n, 'Incorrect updated node count');
    assert.strictEqual(lastNodeAddress, txOptions.from.address, 'Incorrect updated node index');
    assert.equal(details.exists, true, 'Incorrect node exists flag');
    assert.strictEqual(details.timezoneLocation, timezoneLocation, 'Incorrect node timezone location');
}
