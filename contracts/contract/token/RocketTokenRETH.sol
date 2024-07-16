pragma solidity 0.7.6;

// SPDX-License-Identifier: GPL-3.0-only

import "../util/ERC20.sol";

import "../LQGBase.sol";
import "../../interface/deposit/LQGDepositPoolInterface.sol";
import "../../interface/network/LQGNetworkBalancesInterface.sol";
import "../../interface/token/LQGTokenRETHInterface.sol";
import "../../interface/dao/protocol/settings/LQGDAOProtocolSettingsNetworkInterface.sol";

// rETH is a tokenised stake in the LQG Pool network
// rETH is backed by ETH (subject to liquidity) at a variable exchange rate

contract LQGTokenRETH is LQGBase, ERC20, LQGTokenRETHInterface {

    // Libs
    using SafeMath for uint;

    // Events
    event EtherDeposited(address indexed from, uint256 amount, uint256 time);
    event TokensMinted(address indexed to, uint256 amount, uint256 ethAmount, uint256 time);
    event TokensBurned(address indexed from, uint256 amount, uint256 ethAmount, uint256 time);

    // Construct with our token details
    constructor(LQGStorageInterface _lqgStorageAddress) LQGBase(_lqgStorageAddress) ERC20("LQG Pool ETH", "rETH") {
        // Version
        version = 1;
    }

    // Receive an ETH deposit from a minipool or generous individual
    receive() external payable {
        // Emit ether deposited event
        emit EtherDeposited(msg.sender, msg.value, block.timestamp);
    }

    // Calculate the amount of ETH backing an amount of rETH
    function getEthValue(uint256 _rethAmount) override public view returns (uint256) {
        // Get network balances
        LQGNetworkBalancesInterface lqgNetworkBalances = LQGNetworkBalancesInterface(getContractAddress("lqgNetworkBalances"));
        uint256 totalEthBalance = lqgNetworkBalances.getTotalETHBalance();
        uint256 rethSupply = lqgNetworkBalances.getTotalRETHSupply();
        // Use 1:1 ratio if no rETH is minted
        if (rethSupply == 0) { return _rethAmount; }
        // Calculate and return
        return _rethAmount.mul(totalEthBalance).div(rethSupply);
    }

    // Calculate the amount of rETH backed by an amount of ETH
    function getRethValue(uint256 _ethAmount) override public view returns (uint256) {
        // Get network balances
        LQGNetworkBalancesInterface lqgNetworkBalances = LQGNetworkBalancesInterface(getContractAddress("lqgNetworkBalances"));
        uint256 totalEthBalance = lqgNetworkBalances.getTotalETHBalance();
        uint256 rethSupply = lqgNetworkBalances.getTotalRETHSupply();
        // Use 1:1 ratio if no rETH is minted
        if (rethSupply == 0) { return _ethAmount; }
        // Check network ETH balance
        require(totalEthBalance > 0, "Cannot calculate rETH token amount while total network balance is zero");
        // Calculate and return
        return _ethAmount.mul(rethSupply).div(totalEthBalance);
    }

    // Get the current ETH : rETH exchange rate
    // Returns the amount of ETH backing 1 rETH
    function getExchangeRate() override external view returns (uint256) {
        return getEthValue(1 ether);
    }

    // Get the total amount of collateral available
    // Includes rETH contract balance & excess deposit pool balance
    function getTotalCollateral() override public view returns (uint256) {
        LQGDepositPoolInterface lqgDepositPool = LQGDepositPoolInterface(getContractAddress("lqgDepositPool"));
        return lqgDepositPool.getExcessBalance().add(address(this).balance);
    }

    // Get the current ETH collateral rate
    // Returns the portion of rETH backed by ETH in the contract as a fraction of 1 ether
    function getCollateralRate() override public view returns (uint256) {
        uint256 totalEthValue = getEthValue(totalSupply());
        if (totalEthValue == 0) { return calcBase; }
        return calcBase.mul(address(this).balance).div(totalEthValue);
    }

    // Deposit excess ETH from deposit pool
    // Only accepts calls from the LQGDepositPool contract
    function depositExcess() override external payable onlyLatestContract("lqgDepositPool", msg.sender) {
        // Emit ether deposited event
        emit EtherDeposited(msg.sender, msg.value, block.timestamp);
    }

    // Mint rETH
    // Only accepts calls from the LQGDepositPool contract
    function mint(uint256 _ethAmount, address _to) override external onlyLatestContract("lqgDepositPool", msg.sender) {
        // Get rETH amount
        uint256 rethAmount = getRethValue(_ethAmount);
        // Check rETH amount
        require(rethAmount > 0, "Invalid token mint amount");
        // Update balance & supply
        _mint(_to, rethAmount);
        // Emit tokens minted event
        emit TokensMinted(_to, rethAmount, _ethAmount, block.timestamp);
    }

    // Burn rETH for ETH
    function burn(uint256 _rethAmount) override external {
        // Check rETH amount
        require(_rethAmount > 0, "Invalid token burn amount");
        require(balanceOf(msg.sender) >= _rethAmount, "Insufficient rETH balance");
        // Get ETH amount
        uint256 ethAmount = getEthValue(_rethAmount);
        // Get & check ETH balance
        uint256 ethBalance = getTotalCollateral();
        require(ethBalance >= ethAmount, "Insufficient ETH balance for exchange");
        // Update balance & supply
        _burn(msg.sender, _rethAmount);
        // Withdraw ETH from deposit pool if required
        withdrawDepositCollateral(ethAmount);
        // Transfer ETH to sender
        msg.sender.transfer(ethAmount);
        // Emit tokens burned event
        emit TokensBurned(msg.sender, _rethAmount, ethAmount, block.timestamp);
    }

    // Withdraw ETH from the deposit pool for collateral if required
    function withdrawDepositCollateral(uint256 _ethRequired) private {
        // Check rETH contract balance
        uint256 ethBalance = address(this).balance;
        if (ethBalance >= _ethRequired) { return; }
        // Withdraw
        LQGDepositPoolInterface lqgDepositPool = LQGDepositPoolInterface(getContractAddress("lqgDepositPool"));
        lqgDepositPool.withdrawExcessBalance(_ethRequired.sub(ethBalance));
    }

    // Sends any excess ETH from this contract to the deposit pool (as determined by target collateral rate)
    function depositExcessCollateral() external override {
        // Load contracts
        LQGDAOProtocolSettingsNetworkInterface lqgDAOProtocolSettingsNetwork = LQGDAOProtocolSettingsNetworkInterface(getContractAddress("lqgDAOProtocolSettingsNetwork"));
        LQGDepositPoolInterface lqgDepositPool = LQGDepositPoolInterface(getContractAddress("lqgDepositPool"));
        // Get collateral and target collateral rate
        uint256 collateralRate = getCollateralRate();
        uint256 targetCollateralRate = lqgDAOProtocolSettingsNetwork.getTargetRethCollateralRate();
        // Check if we are in excess
        if (collateralRate > targetCollateralRate) {
            // Calculate our target collateral in ETH
            uint256 targetCollateral = address(this).balance.mul(targetCollateralRate).div(collateralRate);
            // If we have excess
            if (address(this).balance > targetCollateral) {
                // Send that excess to deposit pool
                uint256 excessCollateral = address(this).balance.sub(targetCollateral);
                lqgDepositPool.recycleExcessCollateral{value: excessCollateral}();
            }
        }
    }

    // This is called by the base ERC20 contract before all transfer, mint, and burns
    function _beforeTokenTransfer(address from, address, uint256) internal override {
        // Don't run check if this is a mint transaction
        if (from != address(0)) {
            // Check which block the user's last deposit was
            bytes32 key = keccak256(abi.encodePacked("user.deposit.block", from));
            uint256 lastDepositBlock = getUint(key);
            if (lastDepositBlock > 0) {
                // Ensure enough blocks have passed
                uint256 depositDelay = getUint(keccak256(abi.encodePacked(keccak256("dao.protocol.setting.network"), "network.reth.deposit.delay")));
                uint256 blocksPassed = block.number.sub(lastDepositBlock);
                require(blocksPassed > depositDelay, "Not enough time has passed since deposit");
                // Clear the state as it's no longer necessary to check this until another deposit is made
                deleteUint(key);
            }
        }
    }
}
