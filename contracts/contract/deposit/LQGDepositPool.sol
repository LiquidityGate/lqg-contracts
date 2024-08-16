// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../LQGBase.sol";
import "../../interface/LQGVaultInterface.sol";
import "../../interface/LQGVaultWithdrawerInterface.sol";
import "../../interface/deposit/LQGDepositPoolInterface.sol";
import "../../interface/minipool/LQGMinipoolInterface.sol";
import "../../interface/minipool/LQGMinipoolQueueInterface.sol";
import "../../interface/dao/protocol/settings/LQGDAOProtocolSettingsDepositInterface.sol";
import "../../interface/dao/protocol/settings/LQGDAOProtocolSettingsMinipoolInterface.sol";
import "../../interface/dao/protocol/settings/LQGDAOProtocolSettingsNetworkInterface.sol";
import "../../interface/token/LQGTokenRETHInterface.sol";
import "../../types/MinipoolDeposit.sol";

/// @notice Accepts user deposits and mints rETH; handles assignment of deposited ETH to minipools
contract LQGDepositPool is LQGBase, LQGDepositPoolInterface, LQGVaultWithdrawerInterface {

    // Libs
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using SafeCast for uint256;

    // Immutables
    LQGVaultInterface immutable lqgVault;
    LQGTokenRETHInterface immutable lqgTokenRETH;

    // Events
    event DepositReceived(address indexed from, uint256 amount, uint256 time);
    event DepositRecycled(address indexed from, uint256 amount, uint256 time);
    event DepositAssigned(address indexed minipool, uint256 amount, uint256 time);
    event ExcessWithdrawn(address indexed to, uint256 amount, uint256 time);

    // Structs
    struct MinipoolAssignment {
        address minipoolAddress;
        uint256 etherAssigned;
    }

    // Modifiers
    modifier onlyThisLatestContract() {
        // Compiler can optimise out this keccak at compile time
        require(address(this) == getAddress(keccak256("contract.addresslqgDepositPool")), "Invalid or outdated contract");
        _;
    }

    constructor(LQGStorageInterface _lqgStorageAddress) LQGBase(_lqgStorageAddress) {
        version = 3;

        // Pre-retrieve non-upgradable contract addresses to save gas
        lqgVault = LQGVaultInterface(getContractAddress("lqgVault"));
        lqgTokenRETH = LQGTokenRETHInterface(getContractAddress("lqgTokenRETH"));
    }

    /// @notice Returns the current deposit pool balance
    function getBalance() override public view returns (uint256) {
        return lqgVault.balanceOf("lqgDepositPool");
    }

    /// @notice Returns the amount of ETH contributed to the deposit pool by node operators waiting in the queue
    function getNodeBalance() override public view returns (uint256) {
        return getUint("deposit.pool.node.balance");
    }

    /// @notice Returns the user owned portion of the deposit pool (negative indicates more ETH has been "lent" to the
    ///         deposit pool by node operators in the queue than is available from user deposits)
    function getUserBalance() override public view returns (int256) {
        return getBalance().toInt256().sub(getNodeBalance().toInt256());
    }

    /// @notice Excess deposit pool balance (in excess of minipool queue capacity)
    function getExcessBalance() override public view returns (uint256) {
        // Get minipool queue capacity
        LQGMinipoolQueueInterface lqgMinipoolQueue = LQGMinipoolQueueInterface(getContractAddress("lqgMinipoolQueue"));
        uint256 minipoolCapacity = lqgMinipoolQueue.getEffectiveCapacity();
        uint256 balance = getBalance();
        // Calculate and return
        if (minipoolCapacity >= balance) { return 0; }
        else { return balance.sub(minipoolCapacity); }
    }

    /// @dev Callback required to receive ETH withdrawal from the vault
    function receiveVaultWithdrawalETH() override external payable onlyThisLatestContract onlyLatestContract("lqgVault", msg.sender) {}

    /// @notice Deposits ETH into LQG Pool and mints the corresponding amount of rETH to the caller
    function deposit() override external payable onlyThisLatestContract {
        // Check deposit settings
        LQGDAOProtocolSettingsDepositInterface lqgDAOProtocolSettingsDeposit = LQGDAOProtocolSettingsDepositInterface(getContractAddress("lqgDAOProtocolSettingsDeposit"));
        require(lqgDAOProtocolSettingsDeposit.getDepositEnabled(), "Deposits into LQG Pool are currently disabled");
        require(msg.value >= lqgDAOProtocolSettingsDeposit.getMinimumDeposit(), "The deposited amount is less than the minimum deposit size");
        /*
            Check if deposit exceeds limit based on current deposit size and minipool queue capacity.

            The deposit pool can, at most, accept a deposit that, after assignments, matches ETH to every minipool in
            the queue and leaves the deposit pool with maximumDepositPoolSize ETH.

            capacityNeeded = depositPoolBalance + msg.value
            maxCapacity = maximumDepositPoolSize + queueEffectiveCapacity
            assert(capacityNeeded <= maxCapacity)
        */
        uint256 capacityNeeded = getBalance().add(msg.value);
        uint256 maxDepositPoolSize = lqgDAOProtocolSettingsDeposit.getMaximumDepositPoolSize();
        if (capacityNeeded > maxDepositPoolSize) {
            // Doing a conditional require() instead of a single one optimises for the common
            // case where capacityNeeded fits in the deposit pool without looking at the queue
            if (lqgDAOProtocolSettingsDeposit.getAssignDepositsEnabled()) {
                LQGMinipoolQueueInterface lqgMinipoolQueue = LQGMinipoolQueueInterface(getContractAddress("lqgMinipoolQueue"));
                require(capacityNeeded <= maxDepositPoolSize.add(lqgMinipoolQueue.getEffectiveCapacity()),
                    "The deposit pool size after depositing (and matching with minipools) exceeds the maximum size");
            } else {
                revert("The deposit pool size after depositing exceeds the maximum size");
            }
        }
        // Calculate deposit fee
        uint256 depositFee = msg.value.mul(lqgDAOProtocolSettingsDeposit.getDepositFee()).div(calcBase);
        uint256 depositNet = msg.value.sub(depositFee);
        // Mint rETH to user account
        lqgTokenRETH.mint(depositNet, msg.sender);
        // Emit deposit received event
        emit DepositReceived(msg.sender, msg.value, block.timestamp);
        // Process deposit
        processDeposit(lqgDAOProtocolSettingsDeposit);
    }

    /// @notice Returns the maximum amount that can be accepted into the deposit pool at this time in wei
    function getMaximumDepositAmount() override external view returns (uint256) {
        LQGDAOProtocolSettingsDepositInterface lqgDAOProtocolSettingsDeposit = LQGDAOProtocolSettingsDepositInterface(getContractAddress("lqgDAOProtocolSettingsDeposit"));
        // If deposits are enabled max deposit is 0
        if (!lqgDAOProtocolSettingsDeposit.getDepositEnabled()) {
            return 0;
        }
        uint256 depositPoolBalance = getBalance();
        uint256 maxCapacity = lqgDAOProtocolSettingsDeposit.getMaximumDepositPoolSize();
        // When assignments are enabled, we can accept the max amount plus whatever space is available in the minipool queue
        if (lqgDAOProtocolSettingsDeposit.getAssignDepositsEnabled()) {
            LQGMinipoolQueueInterface lqgMinipoolQueue = LQGMinipoolQueueInterface(getContractAddress("lqgMinipoolQueue"));
            maxCapacity = maxCapacity.add(lqgMinipoolQueue.getEffectiveCapacity());
        }
        // Check we aren't already over
        if (depositPoolBalance >= maxCapacity) {
            return 0;
        }
        return maxCapacity.sub(depositPoolBalance);
    }

    /// @dev Accepts ETH deposit from the node deposit contract (does not mint rETH)
    /// @param _totalAmount The total node deposit amount including any credit balance used
    function nodeDeposit(uint256 _totalAmount) override external payable onlyThisLatestContract onlyLatestContract("lqgNodeDeposit", msg.sender) {
        // Deposit ETH into the vault
        if (msg.value > 0) {
            lqgVault.depositEther{value: msg.value}();
        }
        // Increase recorded node balance
        addUint("deposit.pool.node.balance", _totalAmount);
    }

    /// @dev Withdraws ETH from the deposit pool to LQGNodeDeposit contract to be used for a new minipool
    /// @param _amount The amount of ETH to withdraw
    function nodeCreditWithdrawal(uint256 _amount) override external onlyThisLatestContract onlyLatestContract("lqgNodeDeposit", msg.sender) {
        // Withdraw ETH from the vault
        lqgVault.withdrawEther(_amount);
        // Send it to msg.sender (function modifier verifies msg.sender is LQGNodeDeposit)
        (bool success, ) = address(msg.sender).call{value: _amount}("");
        require(success, "Failed to send ETH");
    }

    /// @dev Recycle a deposit from a dissolved minipool
    function recycleDissolvedDeposit() override external payable onlyThisLatestContract onlyRegisteredMinipool(msg.sender) {
        // Load contracts
        LQGDAOProtocolSettingsDepositInterface lqgDAOProtocolSettingsDeposit = LQGDAOProtocolSettingsDepositInterface(getContractAddress("lqgDAOProtocolSettingsDeposit"));
        // Recycle ETH
        emit DepositRecycled(msg.sender, msg.value, block.timestamp);
        processDeposit(lqgDAOProtocolSettingsDeposit);
    }

    /// @dev Recycle excess ETH from the rETH token contract
    function recycleExcessCollateral() override external payable onlyThisLatestContract onlyLatestContract("lqgTokenRETH", msg.sender) {
        // Load contracts
        LQGDAOProtocolSettingsDepositInterface lqgDAOProtocolSettingsDeposit = LQGDAOProtocolSettingsDepositInterface(getContractAddress("lqgDAOProtocolSettingsDeposit"));
        // Recycle ETH
        emit DepositRecycled(msg.sender, msg.value, block.timestamp);
        processDeposit(lqgDAOProtocolSettingsDeposit);
    }

    /// @dev Recycle a liquidated RPL stake from a slashed minipool
    function recycleLiquidatedStake() override external payable onlyThisLatestContract onlyLatestContract("lqgAuctionManager", msg.sender) {
        // Load contracts
        LQGDAOProtocolSettingsDepositInterface lqgDAOProtocolSettingsDeposit = LQGDAOProtocolSettingsDepositInterface(getContractAddress("lqgDAOProtocolSettingsDeposit"));
        // Recycle ETH
        emit DepositRecycled(msg.sender, msg.value, block.timestamp);
        processDeposit(lqgDAOProtocolSettingsDeposit);
    }

    /// @dev Process a deposit
    function processDeposit(LQGDAOProtocolSettingsDepositInterface _lqgDAOProtocolSettingsDeposit) private {
        // Transfer ETH to vault
        lqgVault.depositEther{value: msg.value}();
        // Assign deposits if enabled
        _assignDeposits(_lqgDAOProtocolSettingsDeposit);
    }

    /// @notice Assign deposits to available minipools. Reverts if assigning deposits is disabled.
    function assignDeposits() override external onlyThisLatestContract {
        // Load contracts
        LQGDAOProtocolSettingsDepositInterface lqgDAOProtocolSettingsDeposit = LQGDAOProtocolSettingsDepositInterface(getContractAddress("lqgDAOProtocolSettingsDeposit"));
        // Revert if assigning is disabled
        require(_assignDeposits(lqgDAOProtocolSettingsDeposit), "Deposit assignments are currently disabled");
    }

    /// @dev Assign deposits to available minipools. Does nothing if assigning deposits is disabled.
    function maybeAssignDeposits() override external onlyThisLatestContract returns (bool) {
        // Load contracts
        LQGDAOProtocolSettingsDepositInterface lqgDAOProtocolSettingsDeposit = LQGDAOProtocolSettingsDepositInterface(getContractAddress("lqgDAOProtocolSettingsDeposit"));
        // Revert if assigning is disabled
        return _assignDeposits(lqgDAOProtocolSettingsDeposit);
    }

    /// @dev Assigns deposits to available minipools, returns false if assignment is currently disabled
    function _assignDeposits(LQGDAOProtocolSettingsDepositInterface _lqgDAOProtocolSettingsDeposit) private returns (bool) {
        // Check if assigning deposits is enabled
        if (!_lqgDAOProtocolSettingsDeposit.getAssignDepositsEnabled()) {
            return false;
        }
        // Load contracts
        LQGMinipoolQueueInterface lqgMinipoolQueue = LQGMinipoolQueueInterface(getContractAddress("lqgMinipoolQueue"));
        // Decide which queue processing implementation to use based on queue contents
        if (lqgMinipoolQueue.getContainsLegacy()) {
            return _assignDepositsLegacy(lqgMinipoolQueue, _lqgDAOProtocolSettingsDeposit);
        } else {
            return _assignDepositsNew(lqgMinipoolQueue, _lqgDAOProtocolSettingsDeposit);
        }
    }

    /// @dev Assigns deposits using the new minipool queue
    function _assignDepositsNew(LQGMinipoolQueueInterface _lqgMinipoolQueue, LQGDAOProtocolSettingsDepositInterface _lqgDAOProtocolSettingsDeposit) private returns (bool) {
        // Load contracts
        LQGDAOProtocolSettingsMinipoolInterface lqgDAOProtocolSettingsMinipool = LQGDAOProtocolSettingsMinipoolInterface(getContractAddress("lqgDAOProtocolSettingsMinipool"));
        // Calculate the number of minipools to assign
        uint256 maxAssignments = _lqgDAOProtocolSettingsDeposit.getMaximumDepositAssignments();
        uint256 variableDepositAmount = lqgDAOProtocolSettingsMinipool.getVariableDepositAmount();
        uint256 scalingCount = msg.value.div(variableDepositAmount);
        uint256 totalEthCount = getBalance().div(variableDepositAmount);
        uint256 assignments = _lqgDAOProtocolSettingsDeposit.getMaximumDepositSocialisedAssignments().add(scalingCount);
        if (assignments > totalEthCount) {
            assignments = totalEthCount;
        }
        if (assignments > maxAssignments) {
            assignments = maxAssignments;
        }
        address[] memory minipools = _lqgMinipoolQueue.dequeueMinipools(assignments);
        if (minipools.length > 0){
            // Withdraw ETH from vault
            uint256 totalEther = minipools.length.mul(variableDepositAmount);
            lqgVault.withdrawEther(totalEther);
            uint256 nodeBalanceUsed = 0;
            // Loop over minipools and deposit the amount required to reach launch balance
            for (uint256 i = 0; i < minipools.length; ++i) {
                LQGMinipoolInterface minipool = LQGMinipoolInterface(minipools[i]);
                // Assign deposit to minipool
                minipool.deposit{value: variableDepositAmount}();
                nodeBalanceUsed = nodeBalanceUsed.add(minipool.getNodeTopUpValue());
                // Emit deposit assigned event
                emit DepositAssigned(minipools[i], variableDepositAmount, block.timestamp);
            }
            // Decrease node balance
            subUint("deposit.pool.node.balance", nodeBalanceUsed);
        }
        return true;
    }

    /// @dev Assigns deposits using the legacy minipool queue
    function _assignDepositsLegacy(LQGMinipoolQueueInterface _lqgMinipoolQueue, LQGDAOProtocolSettingsDepositInterface _lqgDAOProtocolSettingsDeposit) private returns (bool) {
        // Load contracts
        LQGDAOProtocolSettingsMinipoolInterface lqgDAOProtocolSettingsMinipool = LQGDAOProtocolSettingsMinipoolInterface(getContractAddress("lqgDAOProtocolSettingsMinipool"));
        // Setup initial variable values
        uint256 balance = getBalance();
        uint256 totalEther = 0;
        // Calculate minipool assignments
        uint256 maxAssignments = _lqgDAOProtocolSettingsDeposit.getMaximumDepositAssignments();
        MinipoolAssignment[] memory assignments = new MinipoolAssignment[](maxAssignments);
        MinipoolDeposit depositType = MinipoolDeposit.None;
        uint256 count = 0;
        uint256 minipoolCapacity = 0;
        for (uint256 i = 0; i < maxAssignments; ++i) {
            // Optimised for multiple of the same deposit type
            if (count == 0) {
                (depositType, count) = _lqgMinipoolQueue.getNextDepositLegacy();
                if (depositType == MinipoolDeposit.None) { break; }
                minipoolCapacity = lqgDAOProtocolSettingsMinipool.getDepositUserAmount(depositType);
            }
            count--;
            if (minipoolCapacity == 0 || balance.sub(totalEther) < minipoolCapacity) { break; }
            // Dequeue the minipool
            address minipoolAddress = _lqgMinipoolQueue.dequeueMinipoolByDepositLegacy(depositType);
            // Update running total
            totalEther = totalEther.add(minipoolCapacity);
            // Add assignment
            assignments[i].etherAssigned = minipoolCapacity;
            assignments[i].minipoolAddress = minipoolAddress;
        }
        if (totalEther > 0) {
            // Withdraw ETH from vault
            lqgVault.withdrawEther(totalEther);
            // Perform assignments
            for (uint256 i = 0; i < maxAssignments; ++i) {
                if (assignments[i].etherAssigned == 0) { break; }
                LQGMinipoolInterface minipool = LQGMinipoolInterface(assignments[i].minipoolAddress);
                // Assign deposit to minipool
                minipool.userDeposit{value: assignments[i].etherAssigned}();
                // Emit deposit assigned event
                emit DepositAssigned(assignments[i].minipoolAddress, assignments[i].etherAssigned, block.timestamp);
            }
        }
        return true;
    }

    /// @dev Withdraw excess deposit pool balance for rETH collateral
    /// @param _amount The amount of excess ETH to withdraw
    function withdrawExcessBalance(uint256 _amount) override external onlyThisLatestContract onlyLatestContract("lqgTokenRETH", msg.sender) {
        // Check amount
        require(_amount <= getExcessBalance(), "Insufficient excess balance for withdrawal");
        // Withdraw ETH from vault
        lqgVault.withdrawEther(_amount);
        // Transfer to rETH contract
        lqgTokenRETH.depositExcess{value: _amount}();
        // Emit excess withdrawn event
        emit ExcessWithdrawn(msg.sender, _amount, block.timestamp);
    }

}
