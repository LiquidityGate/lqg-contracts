import { LQGTokenRPL, LQGVault } from '../_utils/artifacts';
import { setRPLInflationIntervalRate, setRPLInflationStartTime } from '../dao/scenario-dao-protocol-bootstrap';
import { assertBN } from '../_helpers/bn';

const helpers = require('@nomicfoundation/hardhat-network-helpers');

// Set inflation config
export async function rplSetInflationConfig(config, txOptions) {
    // Set the daily inflation start block
    await setRPLInflationStartTime(config.timeStart, txOptions);
    // Set the daily inflation rate
    await setRPLInflationIntervalRate(config.yearlyInflationTarget, txOptions);
}

// Claim the inflation after a set amount of blocks have passed
export async function rplClaimInflation(config, txOptions, tokenAmountToMatch = null) {
    // Convert param to BN
    if (tokenAmountToMatch) {
        tokenAmountToMatch = BigInt(tokenAmountToMatch);
    }

    // Load contracts
    const lqgTokenRPL = await LQGTokenRPL.deployed();
    const lqgVault = await LQGVault.deployed();

    // Get the previously last inflation calculated block
    const timeIntervalLastCalc = await lqgTokenRPL.getInflationCalcTime();

    // Get data about the current inflation
    function getInflationData() {
        return Promise.all([
            helpers.time.latest(),
            lqgTokenRPL.totalSupply(),
            lqgTokenRPL.getInflationIntervalStartTime(),
            lqgTokenRPL.getInflationIntervalsPassed(),
            lqgTokenRPL.getInflationIntervalRate(),
            lqgTokenRPL.getInflationCalcTime(),
            lqgTokenRPL.getInflationIntervalTime(),
            lqgTokenRPL.balanceOf(lqgVault.target),
            lqgVault.balanceOfToken('lqgRewardsPool', lqgTokenRPL.target),
        ]).then(
            ([currentTime, tokenTotalSupply, inflationStartTime, inflationIntervalsPassed, inflationIntervalRate, inflationCalcTime, intervalTime, lqgVaultBalanceRPL, lqgVaultInternalBalanceRPL]) =>
                ({
                    currentTime,
                    tokenTotalSupply,
                    inflationStartTime,
                    inflationIntervalsPassed,
                    inflationIntervalRate,
                    inflationCalcTime,
                    intervalTime,
                    lqgVaultBalanceRPL,
                    lqgVaultInternalBalanceRPL,
                }),
        );
    }

    // Get the current time so we can calculate how much time to pass to make it to the claim time
    let currentTime = await helpers.time.latest();

    // Blocks to process as passing
    let timeToSimulatePassing = config.timeClaim - currentTime;
    // Simulate time passing
    await helpers.time.increase(timeToSimulatePassing);

    // Get initial data
    let inflationData1 = await getInflationData();

    // Starting amount of total supply
    let totalSupplyStart = inflationData1.tokenTotalSupply;

    // Some expected data results based on the passed parameters
    let dailyInflation = ((1 + config.yearlyInflationTarget) ** (1 / (365))).toFixed(18).ether;
    let expectedInflationIntervalsPassed = Number(inflationData1.inflationIntervalsPassed);

    // How many tokens to be expected minted
    let expectedTokensMinted = '0'.ether;

    // Are we expecting inflation? have any intervals passed?
    if (inflationData1.inflationIntervalsPassed > 0) {
        // How much inflation to use based on intervals passed
        let newTotalSupply = totalSupplyStart;

        // Add an extra interval to the calculations match up
        for (let i = 0; i < expectedInflationIntervalsPassed; i++) {
            newTotalSupply = newTotalSupply * dailyInflation / BigInt(1e18);
        }

        // Calculate expected inflation amount
        expectedTokensMinted = newTotalSupply - totalSupplyStart;
    }

    // Claim tokens now
    await lqgTokenRPL.connect(txOptions.from).inflationMintTokens(txOptions);

    // Get inflation data
    let inflationData2 = await getInflationData();

    // Ending amount of total supply
    let totalSupplyEnd = inflationData2.tokenTotalSupply;

    // Verify the minted amount is correct based on inflation rate etc
    assertBN.equal(expectedTokensMinted, totalSupplyEnd - totalSupplyStart, 'Incorrect amount of minted tokens expected');
    // Verify the minted tokens are now stored in LQG Vault on behalf of LQG Rewards Pool
    assertBN.equal(inflationData2.lqgVaultInternalBalanceRPL, inflationData2.lqgVaultBalanceRPL, 'Incorrect amount of tokens stored in LQG Vault for LQG Rewards Pool');
    // Are we verifying an exact amount of tokens given as a required parameter on this pass?
    if (tokenAmountToMatch) {
        tokenAmountToMatch = BigInt(tokenAmountToMatch);
        assertBN.equal(tokenAmountToMatch, totalSupplyEnd / '1'.ether, 'Given token amount does not match total supply made');
    }

    return totalSupplyEnd - totalSupplyStart;
}
