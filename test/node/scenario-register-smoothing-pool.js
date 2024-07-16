import { LQGNodeManager } from '../_utils/artifacts';
import * as assert from 'assert';

// Register a node
export async function setSmoothingPoolRegistrationState(state, txOptions) {
    // Load contracts
    const lqgNodeManager = await LQGNodeManager.deployed();

    // Register
    await lqgNodeManager.connect(txOptions.from).setSmoothingPoolRegistrationState(state, txOptions);

    // Check details
    const newState = await lqgNodeManager.getSmoothingPoolRegistrationState(txOptions.from.address);
    assert.strictEqual(newState, state, 'Incorrect smoothing pool registration state');
}
