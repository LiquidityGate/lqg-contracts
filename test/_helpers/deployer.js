import { artifacts } from '../_utils/artifacts';
import hre from 'hardhat';

const fs = require('fs');
const pako = require('pako');
const ethers = hre.ethers;

function compressABI(abi) {
    return Buffer.from(pako.deflate(JSON.stringify(abi))).toString('base64');
}

function loadABI(abiFilePath) {
    return JSON.parse(fs.readFileSync(abiFilePath));
}

const defaultOpts = {
    protocolVersion: '1.3.1',
    depositAddress: null,
    fixedSupplyTokenAddress: null,
    logging: true,
};

const contractNameMap = {
    lqgVault: 'LQGVault',
    lqgTokenRPL: 'LQGTokenRPL',
    lqgTokenRPLFixedSupply: 'LQGTokenDummyRPL',
    lqgTokenRETH: 'LQGTokenRETH',
    lqgAuctionManager: 'LQGAuctionManager',
    lqgDepositPool: 'LQGDepositPool',
    lqgMinipoolDelegate: 'LQGMinipoolDelegate',
    lqgMinipoolManager: 'LQGMinipoolManager',
    lqgMinipoolQueue: 'LQGMinipoolQueue',
    lqgMinipoolPenalty: 'LQGMinipoolPenalty',
    lqgNetworkBalances: 'LQGNetworkBalances',
    lqgNetworkFees: 'LQGNetworkFees',
    lqgNetworkPrices: 'LQGNetworkPrices',
    lqgNetworkPenalties: 'LQGNetworkPenalties',
    lqgRewardsPool: 'LQGRewardsPool',
    lqgClaimDAO: 'LQGClaimDAO',
    lqgNodeDeposit: 'LQGNodeDeposit',
    lqgNodeManager: 'LQGNodeManager',
    lqgNodeStaking: 'LQGNodeStaking',
    lqgDAOProposal: 'LQGDAOProposal',
    lqgDAONodeTrusted: 'LQGDAONodeTrusted',
    lqgDAONodeTrustedProposals: 'LQGDAONodeTrustedProposals',
    lqgDAONodeTrustedActions: 'LQGDAONodeTrustedActions',
    lqgDAONodeTrustedUpgrade: 'LQGDAONodeTrustedUpgrade',
    lqgDAONodeTrustedSettingsMembers: 'LQGDAONodeTrustedSettingsMembers',
    lqgDAONodeTrustedSettingsProposals: 'LQGDAONodeTrustedSettingsProposals',
    lqgDAONodeTrustedSettingsMinipool: 'LQGDAONodeTrustedSettingsMinipool',
    lqgDAOProtocol: 'LQGDAOProtocol',
    lqgDAOProtocolProposals: 'LQGDAOProtocolProposals',
    lqgDAOProtocolActions: 'LQGDAOProtocolActions',
    lqgDAOProtocolSettingsInflation: 'LQGDAOProtocolSettingsInflation',
    lqgDAOProtocolSettingsRewards: 'LQGDAOProtocolSettingsRewards',
    lqgDAOProtocolSettingsAuction: 'LQGDAOProtocolSettingsAuction',
    lqgDAOProtocolSettingsNode: 'LQGDAOProtocolSettingsNode',
    lqgDAOProtocolSettingsNetwork: 'LQGDAOProtocolSettingsNetwork',
    lqgDAOProtocolSettingsDeposit: 'LQGDAOProtocolSettingsDeposit',
    lqgDAOProtocolSettingsMinipool: 'LQGDAOProtocolSettingsMinipool',
    lqgMerkleDistributorMainnet: 'LQGMerkleDistributorMainnet',
    lqgDAONodeTrustedSettingsRewards: 'LQGDAONodeTrustedSettingsRewards',
    lqgSmoothingPool: 'LQGSmoothingPool',
    lqgNodeDistributorFactory: 'LQGNodeDistributorFactory',
    lqgNodeDistributorDelegate: 'LQGNodeDistributorDelegate',
    lqgMinipoolFactory: 'LQGMinipoolFactory',
    lqgMinipoolBase: 'LQGMinipoolBase',
    lqgMinipoolBondReducer: 'LQGMinipoolBondReducer',
    lqgNetworkSnapshots: 'LQGNetworkSnapshots',
    lqgNetworkVoting: 'LQGNetworkVoting',
    lqgDAOProtocolSettingsProposals: 'LQGDAOProtocolSettingsProposals',
    lqgDAOProtocolVerifier: 'LQGDAOProtocolVerifier',
    lqgDAOSecurity: 'LQGDAOSecurity',
    lqgDAOSecurityActions: 'LQGDAOSecurityActions',
    lqgDAOSecurityProposals: 'LQGDAOSecurityProposals',
    lqgDAOProtocolSettingsSecurity: 'LQGDAOProtocolSettingsSecurity',
    lqgDAOProtocolProposal: 'LQGDAOProtocolProposal',
    addressQueueStorage: 'AddressQueueStorage',
    addressSetStorage: 'AddressSetStorage',
};

export class LQGPoolDeployer {
    signer = null;
    lqgStorageInstance = null;
    contractPlan = {};
    deployedContracts = {};
    skippedContracts = [];
    logDepth = 0;
    buildInfos = {};
    deployBlock = null;

    stages = [];

    constructor(signer, opts = {}) {
        this.signer = signer;

        opts = { ...defaultOpts, ...opts };

        if (!opts.logging) {
            this.log = () => {};
        }

        // Setup default contract deployment plan
        this.contractPlan['lqgStorage'] = {
            constructorArgs: [],
            artifact: artifacts.require('LQGStorage'),
        };

        for (const contract in contractNameMap) {
            this.contractPlan[contract] = {
                constructorArgs: () => this.defaultConstructorArgs(),
                artifact: artifacts.require(contractNameMap[contract]),
            };
        }

        // Override constructor args on certain contracts
        this.contractPlan['lqgTokenRPL'].constructorArgs = () => [this.lqgStorageInstance.target, this.deployedContracts['lqgTokenRPLFixedSupply'].address];
        this.contractPlan['lqgMinipoolDelegate'].constructorArgs = [];
        this.contractPlan['lqgNodeDistributorDelegate'].constructorArgs = [];
        this.contractPlan['lqgMinipoolBase'].constructorArgs = [];

        // Setup deployment
        this.addStage('Deploy storage', 0, [
                async () => this.deployNetworkContract('lqgStorage'),
                async () => this.setString('protocol.version', opts.protocolVersion),
                async () => this.setUint('deploy.block', this.deployBlock),
            ],
        );

        if (opts.depositAddress === null) {
            this.addStage('Deploy deposit contract', 10, [
                    async () => this.deployDepositContract(),
                ],
            );
        } else {
            const abi = compressABI(loadABI('./contracts/contract/casper/compiled/Deposit.abi'));
            this.addStage('Setup deposit contract', 10, [
                    async () => this.setNetworkContractAddress('casperDeposit', opts.depositAddress),
                    async () => this.setNetworkContractAbi('casperDeposit', abi),
                ],
            );
        }

        if (opts.fixedSupplyTokenAddress === null) {
            // Has to be deployed before RPL token as it's used in constructor
            this.addStage('Deploy dummy RPL fixed supply token', 20, [
                    async () => this.deployNetworkContract('lqgTokenRPLFixedSupply'),
                ],
            );
        } else {
            this.addStage('Setup RPL fixed supply', 20, [
                    async () => this.setNetworkContractAddress('lqgTokenRPLFixedSupply', opts.fixedSupplyTokenAddress),
                    async () => this.setNetworkContractAbi('lqgTokenRPLFixedSupply', artifacts.require('lqgTokenRPLFixedSupply').abi),
                ],
            );
            // No need to deploy this anymore
            this.skippedContracts.push('lqgTokenRPLFixedSupply');
        }

        this.addStage('Deploy immutable contracts', 30, [
                async () => this.deployNetworkContract('lqgVault'),
                async () => this.deployNetworkContract('lqgTokenRETH'),
            ],
        );

        this.addStage('Deploy remaining network contracts', 40, [
                async () => this.deployRemainingContracts(),
            ],
        );

        this.addStage('Add combined minipool ABI', 50, [
                async () => this.setNetworkContractAbi('lqgMinipool', compressABI(this.getMinipoolAbi())),
            ],
        );

        this.addStage('Lock storage', 100, [
                async () => this.setDeploymentStatus(),
            ],
        );
    }

    log(string = '\n', color = 'gray') {

        let colorCodes = {
            'white': 0,
            'gray': 37,
            'red': 31,
            'blue': 34,
            'green': 32,
        };

        console.log('%s\x1b[%sm%s\x1b[0m', ''.padEnd(this.logDepth, ' '), colorCodes[color], string);
    }

    addStage(name, priority, steps) {
        this.stages.push({
            name,
            priority,
            steps,
        });
    }

    defaultConstructorArgs() {
        return [this.lqgStorageInstance.target];
    }

    getMinipoolAbi() {
        // Construct ABI for lqgMinipool
        const lqgMinipoolAbi = []
            .concat(artifacts.require('LQGMinipoolDelegate').abi)
            .concat(artifacts.require('LQGMinipoolBase').abi)
            .filter(i => i.type !== 'fallback' && i.type !== 'receive');

        lqgMinipoolAbi.push({ stateMutability: 'payable', type: 'fallback' });
        lqgMinipoolAbi.push({ stateMutability: 'payable', type: 'receive' });

        return lqgMinipoolAbi;
    }

    async setDeploymentStatus() {
        // Disable direct access to storage now
        this.log('- Locking down storage');
        await this.lqgStorageInstance.setDeployedStatus();
    }

    async setString(name, value) {
        this.log('- Setting string `' + name + '` to ' + value, 'white');
        await this.lqgStorageInstance.setString(
            ethers.solidityPackedKeccak256(['string'], ['protocol.version']),
            value,
        );
    }

    async setUint(name, value) {
        this.log('- Setting uint `' + name + '` to ' + value, 'white');
        await this.lqgStorageInstance.setUint(
            ethers.solidityPackedKeccak256(['string'], ['protocol.version']),
            value,
        );
    }

    async deployDepositContract() {
        this.log('- Deploying deposit contract', 'white');
        const abi = loadABI('./contracts/contract/casper/compiled/Deposit.abi');
        const factory = new ethers.ContractFactory(abi, fs.readFileSync('./contracts/contract/casper/compiled/Deposit.bin').toString(), this.signer);
        const instance = await factory.deploy();
        const address = instance.target;

        this.log(`  - Deployed to ${address}`);

        await this.setNetworkContractAddress('casperDeposit', address);
        await this.setNetworkContractAbi('casperDeposit', abi);
    }

    async setNetworkContractAddress(name, address) {
        this.log(`- Setting address for "${name}" in storage to ${address}`);
        // Register the contract address as part of the network
        await this.lqgStorageInstance.setBool(
            ethers.solidityPackedKeccak256(['string', 'address'], ['contract.exists', address]),
            true,
        );
        // Register the contract's name by address
        await this.lqgStorageInstance.setString(
            ethers.solidityPackedKeccak256(['string', 'address'], ['contract.name', address]),
            name,
        );
        // Register the contract's address by name (lqgVault and lqgTokenRETH addresses already stored)
        await this.lqgStorageInstance.setAddress(
            ethers.solidityPackedKeccak256(['string', 'string'], ['contract.address', name]),
            address,
        );
    }

    async setNetworkContractAbi(name, abi) {
        const compressedAbi = compressABI(abi);
        this.log(`- Setting abi for "${name}" in storage to ${compressedAbi.substr(0, 40)}...`);
        // Compress and store the ABI by name
        await this.lqgStorageInstance.setString(
            ethers.solidityPackedKeccak256(['string', 'string'], ['contract.abi', name]),
            compressedAbi,
        );
    }

    async deployRemainingContracts() {
        for (const contract in this.contractPlan) {

            if (this.deployedContracts.hasOwnProperty(contract)) {
                this.log(`- Skipping already deployed ${contract}`, 'red');
                continue;
            }

            if (this.skippedContracts.includes(contract)) {
                this.log(`- Skipping ${contract}`, 'red');
                continue;
            }

            await this.deployNetworkContract(contract);
        }
    }

    async deployNetworkContract(name) {
        const plan = this.contractPlan[name];
        if (!plan) {
            throw Error(`No contract deployment plan for ${name}`);
        }

        let artifact = plan.artifact;
        let abi = artifact.abi;

        this.log(`- Deploying "${name}"`, 'white');

        let constructorArgs = typeof plan.constructorArgs === 'function' ? plan.constructorArgs() : plan.constructorArgs;

        this.logDepth += 2;

        this.log(`- Constructor args = ${JSON.stringify(constructorArgs)}`);

        // Deploy and log result
        const instance = await artifact.newImmediate(...constructorArgs);
        const rsTx = await instance.deploymentTransaction();
        const address = instance.target;
        this.log(`- Deployed to ${address} @ ${rsTx.hash}`);

        // Encode the constructor args
        const iface = new ethers.Interface(abi);
        const encodedConstructorArgs = iface.encodeDeploy(constructorArgs);

        // Special case for lqgStorage as it's used for all value setting
        if (name === 'lqgStorage') {
            this.lqgStorageInstance = instance;
            const receipt = await rsTx.wait();
            this.deployBlock = receipt.blockNumber;
        }

        await this.setNetworkContractAddress(name, address);
        await this.setNetworkContractAbi(name, abi);

        // Add to deployed contracts
        this.deployedContracts[name] = {
            artifact: artifact,
            constructorArgs: encodedConstructorArgs,
            abi: abi,
            address: address,
            instance: instance,
        };

        this.logDepth -= 2;
    }

    async bootstrapProtocolDAOSetting(contractName, settingPath, value) {
        const lqgDAOProtocol = this.deployedContracts['lqgDAOProtocol'].instance;

        if (ethers.isAddress(value)) {
            this.log(`- Bootstrap pDAO setting address \`${settingPath}\` = "${value}" on \`${contractName}\``, 'white')
            await lqgDAOProtocol.bootstrapSettingAddress(contractName, settingPath, value);
        } else {
            if (typeof (value) == 'number' || typeof (value) == 'string' || typeof (value) == 'bigint') {
                this.log(`- Bootstrap pDAO setting uint \`${settingPath}\` = ${value} on \`${contractName}\``, 'white')
                await lqgDAOProtocol.bootstrapSettingUint(contractName, settingPath, value);
            }
            else if (typeof (value) == 'boolean') {
                this.log(`- Bootstrap pDAO setting bool \`${settingPath}\` = ${value} on \`${contractName}\``, 'white')
                await lqgDAOProtocol.bootstrapSettingBool(contractName, settingPath, value);
            }
        }
    }

    async bootstrapProtocolDAOClaimers(trustedNodePerc, protocolPerc, nodePerc) {
        const lqgDAOProtocol = this.deployedContracts['lqgDAOProtocol'].instance;
        this.log(`- Bootstrap pDAO setting claimers: oDAO = ${ethers.formatEther(trustedNodePerc * 100n)}%, protocol = ${ethers.formatEther(protocolPerc * 100n)}%, node = ${ethers.formatEther(nodePerc * 100n)}% `, 'white')
        await lqgDAOProtocol.bootstrapSettingClaimers(trustedNodePerc, protocolPerc, nodePerc);
    }

    async deploy() {
        this.log(`Deploying LQGPool`, 'green');

        // Sort stages by priority
        this.stages.sort((a, b) => a.priority - b.priority);

        // Iterate over stages and execute steps
        for (let l = 0; l < this.stages.length; ++l) {
            const stage = this.stages[l];
            this.log(`# ${stage.name}`, 'blue');

            this.logDepth += 2;

            // Iterate over steps and execute
            for (let i = 0; i < stage.steps.length; ++i) {
                await stage.steps[i]();
            }

            this.logDepth -= 2;

            this.log();
        }

        return this.deployedContracts;
    }
}