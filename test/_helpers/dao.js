import {
    LQGDAONodeTrusted,
    LQGDAONodeTrustedActions,
    LQGDAONodeTrustedSettingsMembers,
    LQGDAOProtocolSettingsProposals,
    LQGDAOProtocolSettingsSecurity,
    LQGDAOProtocolVerifier,
} from '../_utils/artifacts';
import { approveRPL, mintRPL } from './tokens';

export async function mintRPLBond(owner, node) {
    // Load contracts
    const [
        lqgDAONodeTrustedActions,
        lqgDAONodeTrustedSettings,
    ] = await Promise.all([
        LQGDAONodeTrustedActions.deployed(),
        LQGDAONodeTrustedSettingsMembers.deployed(),
    ]);

    // Get RPL bond amount
    const bondAmount = await lqgDAONodeTrustedSettings.getRPLBond.call();

    // Mint RPL amount and approve DAO node contract to spend
    await mintRPL(owner, node, bondAmount);
    await approveRPL(lqgDAONodeTrustedActions.address, bondAmount, { from: node });
}

export async function bootstrapMember(address, id, url, txOptions) {
    const lqgDAONodeTrusted = await LQGDAONodeTrusted.deployed();
    await lqgDAONodeTrusted.bootstrapMember(id, url, address, txOptions);
}

export async function memberJoin(txOptions) {
    const lqgDAONodeTrustedActions = await LQGDAONodeTrustedActions.deployed();
    await lqgDAONodeTrustedActions.actionJoin(txOptions);
}

export async function getDaoProtocolChallenge(proposalID, challengeID) {
    // Load contracts
    const lqgDAOProtocolVerifier = await LQGDAOProtocolVerifier.deployed();
    return lqgDAOProtocolVerifier.getChallenge(proposalID, challengeID);
}

export async function getDaoProtocolVotePhase1Time() {
    // Load contracts
    const lqgDAOProtocolSettingsProposals = await LQGDAOProtocolSettingsProposals.deployed();
    return Number(await lqgDAOProtocolSettingsProposals.getVotePhase1Time());
}

export async function getDaoProtocolVotePhase2Time() {
    // Load contracts
    const lqgDAOProtocolSettingsProposals = await LQGDAOProtocolSettingsProposals.deployed();
    return Number(await lqgDAOProtocolSettingsProposals.getVotePhase2Time());
}

export async function getDaoProtocolVoteDelayTime() {
    // Load contracts
    const lqgDAOProtocolSettingsProposals = await LQGDAOProtocolSettingsProposals.deployed();
    return Number(await lqgDAOProtocolSettingsProposals.getVoteDelayTime());
}

export async function getDaoProtocolSecurityLeaveTime() {
    // Load contracts
    const lqgDAOProtocolSettingsSecurity = await LQGDAOProtocolSettingsSecurity.deployed();
    return Number(await lqgDAOProtocolSettingsSecurity.getLeaveTime());
}

export async function getDaoProtocolDepthPerRound() {
    // Load contracts
    const lqgDAOProtocolVerifier = await LQGDAOProtocolVerifier.deployed();
    return Number(await lqgDAOProtocolVerifier.getDepthPerRound());
}

export async function getDaoProtocolChallengeBond() {
    // Load contracts
    const lqgDAOProtocolSettingsProposals = await LQGDAOProtocolSettingsProposals.deployed();
    return await lqgDAOProtocolSettingsProposals.getChallengeBond();
}

export async function getDaoProtocolProposalBond() {
    // Load contracts
    const lqgDAOProtocolSettingsProposals = await LQGDAOProtocolSettingsProposals.deployed();
    return await lqgDAOProtocolSettingsProposals.getProposalBond();
}

export async function getDaoProtocolChallengePeriod() {
    // Load contracts
    const lqgDAOProtocolSettingsProposals = await LQGDAOProtocolSettingsProposals.deployed();
    return Number(await lqgDAOProtocolSettingsProposals.getChallengePeriod());
}
