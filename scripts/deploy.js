import { LQGPoolDeployer } from '../test/_helpers/deployer';
import { artifacts } from '../test/_utils/artifacts';
import { injectBNHelpers } from '../test/_helpers/bn';
import { EtherscanVerifier } from '../test/_helpers/verify';
import fs from 'fs';
import path from 'path';

const hre = require('hardhat');
const ethers = hre.ethers;

const chain = process.env.CHAIN || 'mainnet';
const verify = process.env.VERIFY === 'true' || false;
const preamble = process.env.PREAMBLE || null;
const etherscanApiKey = process.env.ETHERSCAN_API_KEY || null;

const chainOpts = {
    'mainnet': {
        deployer: {
            depositAddress: '0x00000000219ab540356cBB839Cbe05303d7705Fa',
            lqgTokenRPLFixedSupply: '0xb4efd85c19999d84251304bda99e90b92300bd93',
        },
        deployStorageHelper: false,
        mintDRPL: false,
        setDefaults: false,
    },
    'hoodi': {
        deployer: {
            depositAddress: '0x00000000219ab540356cBB839Cbe05303d7705Fa',
            lqgTokenRPLFixedSupply: null,
        },
        deployStorageHelper: true,
        mintDRPL: true,
        setDefaults: true,
    },
    'hardhat': {
        deployer: { logging: false },
        deployStorageHelper: false,
        mintDRPL: false,
        setDefaults: false,
    },
};

injectBNHelpers();

async function deploy() {
    const opts = chainOpts[chain];
    const [signer] = await ethers.getSigners();
    const deployer = new LQGPoolDeployer(signer, opts.deployer);

    // Add storageHelper to deployment plan
    if (opts.deployStorageHelper) {
        deployer.contractPlan['storageHelper'] = {
            constructorArgs: () => deployer.defaultConstructorArgs(),
            artifact: artifacts.require('StorageHelper'),
        };
    }

    // Bootstrap default parameters
    if (opts.setDefaults) {
        deployer.addStage('Set default parameters', 110, [
            async () => {
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsDeposit', 'deposit.enabled', true);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsDeposit', 'deposit.assign.enabled', true);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsDeposit', 'deposit.pool.maximum', '1000'.ether);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsNode', 'node.registration.enabled', true);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsNode', 'node.deposit.enabled', true);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsNode', 'node.vacant.minipools.enabled', true);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsMinipool', 'minipool.submit.withdrawable.enabled', true);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsMinipool', 'minipool.bond.reduction.enabled', true);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsNetwork', 'network.node.fee.minimum', '0.05'.ether);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsNetwork', 'network.node.fee.target', '0.1'.ether);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsNetwork', 'network.node.fee.maximum', '0.2'.ether);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsNetwork', 'network.node.demand.range', '1000'.ether);
                await deployer.bootstrapProtocolDAOSetting('lqgDAOProtocolSettingsInflation', 'rpl.inflation.interval.start', Math.floor(new Date().getTime() / 1000) + (60 * 60 * 24 * 14));
                await deployer.bootstrapProtocolDAOClaimers('0.275'.ether, '0.025'.ether, '0.7'.ether);
            },
        ]);
    }

    // Mint the total DRPL supply to the deployer
    if (opts.mintDRPL) {
        deployer.addStage('Mint DRPL supply', 120, [
            async () => {
                const lqgTokenRPLFixedSupply = deployer.deployedContracts['lqgTokenRPLFixedSupply'].instance;
                const totalSupplyCap = await lqgTokenRPLFixedSupply.totalSupplyCap();
                deployer.log(`- Minting ${ethers.formatEther(totalSupplyCap)} DRPL to ${signer.address}`, 'white');
                await lqgTokenRPLFixedSupply.mint(signer.address, totalSupplyCap);
            },
        ]);
    }

    const balance = await ethers.provider.getBalance(signer.address);
    console.log(`Chain: ${chain}`);
    console.log(`Deployer: ${signer.address}`);
    console.log(`Deployer Balance: ${ethers.formatEther(balance)} ETH`);
    console.log('\n');

    // Perform deployment
    const contracts = await deployer.deploy();

    // Skip save and verify when deploying to hardhat
    if (chain === 'hardhat') {
        return;
    }

    // Compile deployment information for saving
    const deploymentData = {
        deployer: signer.address,
        chain: chain,
        verification: [],
        addresses: {},
        buildInfos: {},
    };

    // Compile set of build infos
    const buildInfoMap = {};
    for (const contract in contracts) {
        const artifact = contracts[contract].artifact;
        const buildInfo = hre.artifacts.getBuildInfoSync(`${artifact.sourceName}:${artifact.contractName}`);
        deploymentData.buildInfos[buildInfo.id] = buildInfo;
        buildInfoMap[contract] = buildInfo.id;
    }

    // Compile list of information needed for verification
    for (const contract in contracts) {
        const artifact = contracts[contract].artifact;
        deploymentData.verification.push({
            sourceName: artifact.sourceName,
            contractName: artifact.contractName,
            address: contracts[contract].address,
            constructorArgs: contracts[contract].constructorArgs,
            buildInfoId: buildInfoMap[contract],
        });
        deploymentData.addresses[artifact.contractName] = contracts[contract].address;
    }

    // Save deployment data
    const deployFile = 'deployments' + path.sep + chain + '_' + (new Date().toISOString()) + '.json';
    if (!fs.existsSync('deployments')) {
        fs.mkdirSync('deployments');
    }
    const jsonDeploymentData = JSON.stringify(deploymentData, null, 2);
    fs.writeFileSync(deployFile, jsonDeploymentData, 'utf8');
    fs.writeFileSync('deployments' + path.sep + 'latest.json', jsonDeploymentData, 'utf8');

    console.log('Deployment data saved to `' + deployFile + '`');
    console.log();

    // Optionally start verification process
    if (verify) {
        // Verify all deployed contracts
        const verifierOpts = {
            chain: chain,
            preamble: preamble !== null ? fs.readFileSync(process.cwd() + path.sep + preamble, 'utf8') : '',
            apiKey: etherscanApiKey,
        };
        const verifier = new EtherscanVerifier(deploymentData.buildInfos, verifierOpts);
        const verificationResults = await verifier.verifyAll(deploymentData.verification);

        console.log();
        console.log('# Verification results')
        console.log();

        for (const contract in verificationResults) {
            const guid = verificationResults[contract];
            if (guid === null) {
                console.log(`  - ${contract}: Failed to submit`);
            } else {
                const status = await verifier.getVerificationStatus(verificationResults[contract]);
                console.log(`  - ${contract}: ${status.result}`);
            }
        }

        console.log();
    }

    console.log('# Deployment complete');
}

deploy().then(() => process.exit());

