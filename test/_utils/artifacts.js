const hre = require('hardhat');
const ethers = hre.ethers;

class Artifact {
    constructor(name) {
        this.name = name;
        const hreArtifact = hre.artifacts.readArtifactSync(name);
        this.abi = hreArtifact.abi;
        this.contractName = hreArtifact.contractName;
        this.sourceName = hreArtifact.sourceName;
        this.instance = null;
    }

    async deployed() {
        return this.instance;
    }

    setAsDeployed(instance) {
        this.instance = instance;
    }

    async newImmediate(...args) {
        this.instance = await (await ethers.getContractFactory(this.name)).deploy(...args);
        return this.instance;
    }

    async new(...args) {
        this.instance = (await ethers.getContractFactory(this.name)).deploy(...args);
        return this.instance;
    }

    async clone(...args) {
        return (await ethers.getContractFactory(this.name)).deploy(...args);
    }

    at (address) {
        return new ethers.Contract(address, this.abi, hre.ethers.provider);
    }
}

class Artifacts {
    constructor() {
        this.artifacts = {};
    }

    require(name) {
        if (!this.artifacts.hasOwnProperty(name)) {
            this.artifacts[name] = new Artifact(name);
        }
        return this.artifacts[name];
    }
}

export const artifacts = new Artifacts();

export const LQGAuctionManager = artifacts.require('LQGAuctionManager');
export const LQGClaimDAO = artifacts.require('LQGClaimDAO');
export const LQGDAONodeTrusted = artifacts.require('LQGDAONodeTrusted');
export const LQGDAONodeTrustedActions = artifacts.require('LQGDAONodeTrustedActions');
export const LQGDAONodeTrustedProposals = artifacts.require('LQGDAONodeTrustedProposals');
export const LQGDAONodeTrustedSettingsMembers = artifacts.require('LQGDAONodeTrustedSettingsMembers');
export const LQGDAONodeTrustedSettingsProposals = artifacts.require('LQGDAONodeTrustedSettingsProposals');
export const LQGDAONodeTrustedSettingsMinipool = artifacts.require('LQGDAONodeTrustedSettingsMinipool');
export const LQGDAONodeTrustedUpgrade = artifacts.require('LQGDAONodeTrustedUpgrade');
export const LQGDAOProtocol = artifacts.require('LQGDAOProtocol');
export const LQGDAOProtocolProposals = artifacts.require('LQGDAOProtocolProposals');
export const LQGDAOProtocolProposal = artifacts.require('LQGDAOProtocolProposal');
export const LQGDAOProtocolSettingsAuction = artifacts.require('LQGDAOProtocolSettingsAuction');
export const LQGDAOProtocolSettingsDeposit = artifacts.require('LQGDAOProtocolSettingsDeposit');
export const LQGDAOProtocolSettingsInflation = artifacts.require('LQGDAOProtocolSettingsInflation');
export const LQGDAOProtocolSettingsNetwork = artifacts.require('LQGDAOProtocolSettingsNetwork');
export const LQGDAOProtocolSettingsNode = artifacts.require('LQGDAOProtocolSettingsNode');
export const LQGDAOProtocolSettingsRewards = artifacts.require('LQGDAOProtocolSettingsRewards');
export const LQGDAOProtocolSettingsProposals = artifacts.require('LQGDAOProtocolSettingsProposals');
export const LQGDAOProtocolSettingsSecurity = artifacts.require('LQGDAOProtocolSettingsSecurity');
export const LQGDAOProtocolVerifier = artifacts.require('LQGDAOProtocolVerifier');
export const LQGDAOProposal = artifacts.require('LQGDAOProposal');
export const LQGDAOSecurityActions = artifacts.require('LQGDAOSecurityActions');
export const LQGDAOSecurityProposals = artifacts.require('LQGDAOSecurityProposals');
export const LQGDAOSecurity = artifacts.require('LQGDAOSecurity');
export const LQGMinipoolPenalty = artifacts.require('LQGMinipoolPenalty');
export const LQGMinipoolManager = artifacts.require('LQGMinipoolManager');
export const LQGNetworkBalances = artifacts.require('LQGNetworkBalances');
export const LQGNetworkPenalties = artifacts.require('LQGNetworkPenalties');
export const LQGNetworkFees = artifacts.require('LQGNetworkFees');
export const LQGNetworkPrices = artifacts.require('LQGNetworkPrices');
export const LQGNodeManager = artifacts.require('LQGNodeManager');
export const LQGNodeStaking = artifacts.require('LQGNodeStaking');
export const LQGNodeDistributorFactory = artifacts.require('LQGNodeDistributorFactory');
export const LQGNodeDistributorDelegate = artifacts.require('LQGNodeDistributorDelegate');
export const LQGRewardsPool = artifacts.require('LQGRewardsPool');
export const LQGMerkleDistributorMainnet = artifacts.require('LQGMerkleDistributorMainnet');
export const LQGSmoothingPool = artifacts.require('LQGSmoothingPool');
export const LQGStorage = artifacts.require('LQGStorage');
export const LQGTokenDummyRPL = artifacts.require('LQGTokenDummyRPL');
export const LQGTokenRETH = artifacts.require('LQGTokenRETH');
export const LQGTokenRPL = artifacts.require('LQGTokenRPL');
export const LQGVault = artifacts.require('LQGVault');
export const RevertOnTransfer = artifacts.require('RevertOnTransfer');
export const PenaltyTest = artifacts.require('PenaltyTest');
export const SnapshotTest = artifacts.require('SnapshotTest');
export const LQGMinipoolFactory = artifacts.require('LQGMinipoolFactory');
export const LQGMinipoolBase = artifacts.require('LQGMinipoolBase');
export const LQGMinipoolQueue = artifacts.require('LQGMinipoolQueue');
export const LQGNodeDeposit = artifacts.require('LQGNodeDeposit');
export const LQGMinipoolDelegate = artifacts.require('LQGMinipoolDelegate');
export const LQGDAOProtocolSettingsMinipool = artifacts.require('LQGDAOProtocolSettingsMinipool');
export const LQGDepositPool = artifacts.require('LQGDepositPool');
export const LQGMinipoolBondReducer = artifacts.require('LQGMinipoolBondReducer');
export const LQGNetworkSnapshots = artifacts.require('LQGNetworkSnapshots');
export const LQGNetworkVoting = artifacts.require('LQGNetworkVoting');
