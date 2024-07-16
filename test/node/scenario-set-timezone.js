import { LQGNodeManager } from '../../test/_utils/artifacts';
import * as assert from 'assert';

// Set a node's timezone location
export async function setTimezoneLocation(timezoneLocation, txOptions) {
    // Load contracts
    const lqgNodeManager = await LQGNodeManager.deployed();

    // Set timezone location
    await lqgNodeManager.connect(txOptions.from).setTimezoneLocation(timezoneLocation, txOptions);

    // Get timezone location
    let nodeTimezoneLocation = await lqgNodeManager.getNodeTimezoneLocation(txOptions.from.address);

    // Check
    assert.strictEqual(nodeTimezoneLocation, timezoneLocation, 'Incorrect updated timezone location');
}
