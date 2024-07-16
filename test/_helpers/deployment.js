/*** Dependencies ********************/
import { artifacts } from '../_utils/artifacts';
import { LQGPoolDeployer } from './deployer';

const hre = require('hardhat');
const ethers = hre.ethers;

// Development helper contracts
const revertOnTransfer = artifacts.require('RevertOnTransfer');
const lqgNodeDepositLEB4 = artifacts.require('LQGNodeDepositLEB4');

// Deploy LQG Pool
export async function deployLQGPool() {
    const [signer] = await ethers.getSigners();
    const deployer = new LQGPoolDeployer(signer, { logging: false });
    await deployer.deploy();

    let instance = await revertOnTransfer.new();
    revertOnTransfer.setAsDeployed(instance);

    instance = await lqgNodeDepositLEB4.new(deployer.lqgStorageInstance.target);
    lqgNodeDepositLEB4.setAsDeployed(instance);
}
