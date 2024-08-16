// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";

import "./LQGMinipoolStorageLayout.sol";
import "../../interface/casper/DepositInterface.sol";
import "../../interface/deposit/LQGDepositPoolInterface.sol";
import "../../interface/minipool/LQGMinipoolInterface.sol";
import "../../interface/minipool/LQGMinipoolManagerInterface.sol";
import "../../interface/minipool/LQGMinipoolQueueInterface.sol";
import "../../interface/minipool/LQGMinipoolPenaltyInterface.sol";
import "../../interface/node/LQGNodeStakingInterface.sol";
import "../../interface/dao/protocol/settings/LQGDAOProtocolSettingsMinipoolInterface.sol";
import "../../interface/dao/node/settings/LQGDAONodeTrustedSettingsMinipoolInterface.sol";
import "../../interface/dao/protocol/settings/LQGDAOProtocolSettingsNodeInterface.sol";
import "../../interface/dao/node/LQGDAONodeTrustedInterface.sol";
import "../../interface/network/LQGNetworkFeesInterface.sol";
import "../../interface/token/LQGTokenRETHInterface.sol";
import "../../types/MinipoolDeposit.sol";
import "../../types/MinipoolStatus.sol";
import "../../interface/node/LQGNodeDepositInterface.sol";
import "../../interface/minipool/LQGMinipoolBondReducerInterface.sol";

/// @notice Provides the logic for each individual minipool in the LQG Pool network
/// @dev Minipools exclusively DELEGATECALL into this contract it is never called directly
contract LQGMinipoolDelegate is LQGMinipoolStorageLayout, LQGMinipoolInterface {

    // Constants
    uint8 public constant override version = 3;                   // Used to identify which delegate contract each minipool is using
    uint256 internal constant calcBase = 1 ether;                 // Fixed point arithmetic uses this for value for precision
    uint256 internal constant legacyPrelaunchAmount = 16 ether;   // The amount of ETH initially deposited when minipool is created (for legacy minipools)
    uint256 internal constant scrubPenalty = 2.4 ether;           // Amount of ETH penalised during a successful scrub

    // Libs
    using SafeMath for uint;

    // Events
    event StatusUpdated(uint8 indexed status, uint256 time);
    event ScrubVoted(address indexed member, uint256 time);
    event BondReduced(uint256 previousBondAmount, uint256 newBondAmount, uint256 time);
    event MinipoolScrubbed(uint256 time);
    event MinipoolPrestaked(bytes validatorPubkey, bytes validatorSignature, bytes32 depositDataRoot, uint256 amount, bytes withdrawalCredentials, uint256 time);
    event MinipoolPromoted(uint256 time);
    event MinipoolVacancyPrepared(uint256 bondAmount, uint256 currentBalance, uint256 time);
    event EtherDeposited(address indexed from, uint256 amount, uint256 time);
    event EtherWithdrawn(address indexed to, uint256 amount, uint256 time);
    event EtherWithdrawalProcessed(address indexed executed, uint256 nodeAmount, uint256 userAmount, uint256 totalBalance, uint256 time);

    // Status getters
    function getStatus() override external view returns (MinipoolStatus) { return status; }
    function getFinalised() override external view returns (bool) { return finalised; }
    function getStatusBlock() override external view returns (uint256) { return statusBlock; }
    function getStatusTime() override external view returns (uint256) { return statusTime; }
    function getScrubVoted(address _member) override external view returns (bool) { return memberScrubVotes[_member]; }

    // Deposit type getter
    function getDepositType() override external view returns (MinipoolDeposit) { return depositType; }

    // Node detail getters
    function getNodeAddress() override external view returns (address) { return nodeAddress; }
    function getNodeFee() override external view returns (uint256) { return nodeFee; }
    function getNodeDepositBalance() override external view returns (uint256) { return nodeDepositBalance; }
    function getNodeRefundBalance() override external view returns (uint256) { return nodeRefundBalance; }
    function getNodeDepositAssigned() override external view returns (bool) { return userDepositAssignedTime != 0; }
    function getPreLaunchValue() override external view returns (uint256) { return preLaunchValue; }
    function getNodeTopUpValue() override external view returns (uint256) { return nodeDepositBalance.sub(preLaunchValue); }
    function getVacant() override external view returns (bool) { return vacant; }
    function getPreMigrationBalance() override external view returns (uint256) { return preMigrationBalance; }
    function getUserDistributed() override external view returns (bool) { return userDistributed; }

    // User deposit detail getters
    function getUserDepositBalance() override public view returns (uint256) {
        if (depositType == MinipoolDeposit.Variable) {
            return userDepositBalance;
        } else {
            return userDepositBalanceLegacy;
        }
    }
    function getUserDepositAssigned() override external view returns (bool) { return userDepositAssignedTime != 0; }
    function getUserDepositAssignedTime() override external view returns (uint256) { return userDepositAssignedTime; }
    function getTotalScrubVotes() override external view returns (uint256) { return totalScrubVotes; }

    /// @dev Prevent direct calls to this contract
    modifier onlyInitialised() {
        require(storageState == StorageState.Initialised, "Storage state not initialised");
        _;
    }

    /// @dev Prevent multiple calls to initialise
    modifier onlyUninitialised() {
        require(storageState == StorageState.Uninitialised, "Storage state already initialised");
        _;
    }

    /// @dev Only allow access from the owning node address
    modifier onlyMinipoolOwner(address _nodeAddress) {
        require(_nodeAddress == nodeAddress, "Invalid minipool owner");
        _;
    }

    /// @dev Only allow access from the owning node address or their withdrawal address
    modifier onlyMinipoolOwnerOrWithdrawalAddress(address _nodeAddress) {
        require(_nodeAddress == nodeAddress || _nodeAddress == lqgStorage.getNodeWithdrawalAddress(nodeAddress), "Invalid minipool owner");
        _;
    }

    /// @dev Only allow access from the latest version of the specified LQG Pool contract
    modifier onlyLatestContract(string memory _contractName, address _contractAddress) {
        require(_contractAddress == getContractAddress(_contractName), "Invalid or outdated contract");
        _;
    }

    /// @dev Get the address of a LQG Pool network contract
    /// @param _contractName The internal name of the contract to retrieve the address for
    function getContractAddress(string memory _contractName) private view returns (address) {
        address contractAddress = lqgStorage.getAddress(keccak256(abi.encodePacked("contract.address", _contractName)));
        require(contractAddress != address(0x0), "Contract not found");
        return contractAddress;
    }

    /// @dev Called once on creation to initialise starting state
    /// @param _nodeAddress The address of the node operator who will own this minipool
    function initialise(address _nodeAddress) override external onlyUninitialised {
        // Check parameters
        require(_nodeAddress != address(0x0), "Invalid node address");
        // Load contracts
        LQGNetworkFeesInterface lqgNetworkFees = LQGNetworkFeesInterface(getContractAddress("lqgNetworkFees"));
        // Set initial status
        status = MinipoolStatus.Initialised;
        statusBlock = block.number;
        statusTime = block.timestamp;
        // Set details
        depositType = MinipoolDeposit.Variable;
        nodeAddress = _nodeAddress;
        nodeFee = lqgNetworkFees.getNodeFee();
        // Set the rETH address
        lqgTokenRETH = getContractAddress("lqgTokenRETH");
        // Set local copy of penalty contract
        lqgMinipoolPenalty = getContractAddress("lqgMinipoolPenalty");
        // Intialise storage state
        storageState = StorageState.Initialised;
    }

    /// @notice Performs the initial pre-stake on the beacon chain to set the withdrawal credentials
    /// @param _bondValue The amount of the stake which will be provided by the node operator
    /// @param _validatorPubkey The public key of the validator
    /// @param _validatorSignature A signature over the deposit message object
    /// @param _depositDataRoot The hash tree root of the deposit data object
    function preDeposit(uint256 _bondValue, bytes calldata _validatorPubkey, bytes calldata _validatorSignature, bytes32 _depositDataRoot) override external payable onlyLatestContract("lqgNodeDeposit", msg.sender) onlyInitialised {
        // Check current status & node deposit status
        require(status == MinipoolStatus.Initialised, "The pre-deposit can only be made while initialised");
        require(preLaunchValue == 0, "Pre-deposit already performed");
        // Update node deposit details
        nodeDepositBalance = _bondValue;
        preLaunchValue = msg.value;
        // Emit ether deposited event
        emit EtherDeposited(msg.sender, preLaunchValue, block.timestamp);
        // Perform the pre-stake to lock in withdrawal credentials on beacon chain
        preStake(_validatorPubkey, _validatorSignature, _depositDataRoot);
    }

    /// @notice Performs the second deposit which provides the validator with the remaining balance to become active
    function deposit() override external payable onlyLatestContract("lqgDepositPool", msg.sender) onlyInitialised {
        // Check current status & node deposit status
        require(status == MinipoolStatus.Initialised, "The node deposit can only be assigned while initialised");
        require(userDepositAssignedTime == 0, "The user deposit has already been assigned");
        // Set the minipool status to prelaunch (ready for node to call `stake()`)
        setStatus(MinipoolStatus.Prelaunch);
        // Update deposit details
        userDepositBalance = msg.value.add(preLaunchValue).sub(nodeDepositBalance);
        userDepositAssignedTime = block.timestamp;
        // Emit ether deposited event
        emit EtherDeposited(msg.sender, msg.value, block.timestamp);
    }

    /// @notice Assign user deposited ETH to the minipool and mark it as prelaunch
    /// @dev No longer used in "Variable" type minipools (only retained for legacy minipools still in queue)
    function userDeposit() override external payable onlyLatestContract("lqgDepositPool", msg.sender) onlyInitialised {
        // Check current status & user deposit status
        require(status >= MinipoolStatus.Initialised && status <= MinipoolStatus.Staking, "The user deposit can only be assigned while initialised, in prelaunch, or staking");
        require(userDepositAssignedTime == 0, "The user deposit has already been assigned");
        // Progress initialised minipool to prelaunch
        if (status == MinipoolStatus.Initialised) { setStatus(MinipoolStatus.Prelaunch); }
        // Update user deposit details
        userDepositBalance = msg.value;
        userDepositAssignedTime = block.timestamp;
        // Refinance full minipool
        if (depositType == MinipoolDeposit.Full) {
            // Update node balances
            nodeDepositBalance = nodeDepositBalance.sub(msg.value);
            nodeRefundBalance = nodeRefundBalance.add(msg.value);
        }
        // Emit ether deposited event
        emit EtherDeposited(msg.sender, msg.value, block.timestamp);
    }

    /// @notice Refund node ETH refinanced from user deposited ETH
    function refund() override external onlyMinipoolOwnerOrWithdrawalAddress(msg.sender) onlyInitialised {
        // Check refund balance
        require(nodeRefundBalance > 0, "No amount of the node deposit is available for refund");
        // If this minipool was distributed by a user, force finalisation on the node operator
        if (!finalised && userDistributed) {
            // Note: _refund is called inside _finalise
            _finalise();
        } else {
            // Refund node
            _refund();
        }
    }

    /// @notice Called to slash node operator's RPL balance if withdrawal balance was less than user deposit
    function slash() external override onlyInitialised {
        // Check there is a slash balance
        require(nodeSlashBalance > 0, "No balance to slash");
        // Perform slash
        _slash();
    }

    /// @notice Returns true when `stake()` can be called by node operator taking into consideration the scrub period
    function canStake() override external view onlyInitialised returns (bool) {
        // Check status
        if (status != MinipoolStatus.Prelaunch) {
            return false;
        }
        // Get contracts
        LQGDAONodeTrustedSettingsMinipoolInterface lqgDAONodeTrustedSettingsMinipool = LQGDAONodeTrustedSettingsMinipoolInterface(getContractAddress("lqgDAONodeTrustedSettingsMinipool"));
        // Get scrub period
        uint256 scrubPeriod = lqgDAONodeTrustedSettingsMinipool.getScrubPeriod();
        // Check if we have been in prelaunch status for long enough
        return block.timestamp > statusTime + scrubPeriod;
    }

    /// @notice Returns true when `promote()` can be called by node operator taking into consideration the scrub period
    function canPromote() override external view onlyInitialised returns (bool) {
        // Check status
        if (status != MinipoolStatus.Prelaunch) {
            return false;
        }
        // Get contracts
        LQGDAONodeTrustedSettingsMinipoolInterface lqgDAONodeTrustedSettingsMinipool = LQGDAONodeTrustedSettingsMinipoolInterface(getContractAddress("lqgDAONodeTrustedSettingsMinipool"));
        // Get scrub period
        uint256 scrubPeriod = lqgDAONodeTrustedSettingsMinipool.getPromotionScrubPeriod();
        // Check if we have been in prelaunch status for long enough
        return block.timestamp > statusTime + scrubPeriod;
    }

    /// @notice Progress the minipool to staking, sending its ETH deposit to the deposit contract. Only accepts calls from the minipool owner (node) while in prelaunch and once scrub period has ended
    /// @param _validatorSignature A signature over the deposit message object
    /// @param _depositDataRoot The hash tree root of the deposit data object
    function stake(bytes calldata _validatorSignature, bytes32 _depositDataRoot) override external onlyMinipoolOwner(msg.sender) onlyInitialised {
        // Get contracts
        LQGDAOProtocolSettingsMinipoolInterface lqgDAOProtocolSettingsMinipool = LQGDAOProtocolSettingsMinipoolInterface(getContractAddress("lqgDAOProtocolSettingsMinipool"));
        {
            // Get scrub period
            LQGDAONodeTrustedSettingsMinipoolInterface lqgDAONodeTrustedSettingsMinipool = LQGDAONodeTrustedSettingsMinipoolInterface(getContractAddress("lqgDAONodeTrustedSettingsMinipool"));
            uint256 scrubPeriod = lqgDAONodeTrustedSettingsMinipool.getScrubPeriod();
            // Check current status
            require(status == MinipoolStatus.Prelaunch, "The minipool can only begin staking while in prelaunch");
            require(block.timestamp > statusTime + scrubPeriod, "Not enough time has passed to stake");
            require(!vacant, "Cannot stake a vacant minipool");
        }
        // Progress to staking
        setStatus(MinipoolStatus.Staking);
        // Load contracts
        DepositInterface casperDeposit = DepositInterface(getContractAddress("casperDeposit"));
        LQGMinipoolManagerInterface lqgMinipoolManager = LQGMinipoolManagerInterface(getContractAddress("lqgMinipoolManager"));
        // Get launch amount
        uint256 launchAmount = lqgDAOProtocolSettingsMinipool.getLaunchBalance();
        uint256 depositAmount;
        // Legacy minipools had a prestake equal to the bond amount
        if (depositType == MinipoolDeposit.Variable) {
            depositAmount = launchAmount.sub(preLaunchValue);
        } else {
            depositAmount = launchAmount.sub(legacyPrelaunchAmount);
        }
        // Check minipool balance
        require(address(this).balance >= depositAmount, "Insufficient balance to begin staking");
        // Retrieve validator pubkey from storage
        bytes memory validatorPubkey = lqgMinipoolManager.getMinipoolPubkey(address(this));
        // Send staking deposit to casper
        casperDeposit.deposit{value : depositAmount}(validatorPubkey, lqgMinipoolManager.getMinipoolWithdrawalCredentials(address(this)), _validatorSignature, _depositDataRoot);
        // Increment node's number of staking minipools
        lqgMinipoolManager.incrementNodeStakingMinipoolCount(nodeAddress);
    }

    /// @dev Sets the bond value and vacancy flag on this minipool
    /// @param _bondAmount The bond amount selected by the node operator
    /// @param _currentBalance The current balance of the validator on the beaconchain (will be checked by oDAO and scrubbed if not correct)
    function prepareVacancy(uint256 _bondAmount, uint256 _currentBalance) override external onlyLatestContract("lqgMinipoolManager", msg.sender) onlyInitialised {
        // Check status
        require(status == MinipoolStatus.Initialised, "Must be in initialised status");
        // Sanity check that refund balance is zero
        require(nodeRefundBalance == 0, "Refund balance not zero");
        // Check balance
        LQGDAOProtocolSettingsMinipoolInterface lqgDAOProtocolSettingsMinipool = LQGDAOProtocolSettingsMinipoolInterface(getContractAddress("lqgDAOProtocolSettingsMinipool"));
        uint256 launchAmount = lqgDAOProtocolSettingsMinipool.getLaunchBalance();
        require(_currentBalance >= launchAmount, "Balance is too low");
        // Store bond amount
        nodeDepositBalance = _bondAmount;
        // Calculate user amount from launch amount
        userDepositBalance = launchAmount.sub(nodeDepositBalance);
        // Flag as vacant
        vacant = true;
        preMigrationBalance = _currentBalance;
        // Refund the node whatever rewards they have accrued prior to becoming a RP validator
        nodeRefundBalance = _currentBalance.sub(launchAmount);
        // Set status to preLaunch
        setStatus(MinipoolStatus.Prelaunch);
        // Emit event
        emit MinipoolVacancyPrepared(_bondAmount, _currentBalance, block.timestamp);
    }

    /// @dev Promotes this minipool to a complete minipool
    function promote() override external onlyMinipoolOwner(msg.sender) onlyInitialised {
        // Check status
        require(status == MinipoolStatus.Prelaunch, "The minipool can only promote while in prelaunch");
        require(vacant, "Cannot promote a non-vacant minipool");
        // Get contracts
        LQGDAONodeTrustedSettingsMinipoolInterface lqgDAONodeTrustedSettingsMinipool = LQGDAONodeTrustedSettingsMinipoolInterface(getContractAddress("lqgDAONodeTrustedSettingsMinipool"));
        // Clear vacant flag
        vacant = false;
        // Check scrub period
        uint256 scrubPeriod = lqgDAONodeTrustedSettingsMinipool.getPromotionScrubPeriod();
        require(block.timestamp > statusTime + scrubPeriod, "Not enough time has passed to promote");
        // Progress to staking
        setStatus(MinipoolStatus.Staking);
        // Increment node's number of staking minipools
        LQGMinipoolManagerInterface lqgMinipoolManager = LQGMinipoolManagerInterface(getContractAddress("lqgMinipoolManager"));
        lqgMinipoolManager.incrementNodeStakingMinipoolCount(nodeAddress);
        // Set deposit assigned time
        userDepositAssignedTime = block.timestamp;
        // Increase node operator's deposit credit
        LQGNodeDepositInterface lqgNodeDepositInterface = LQGNodeDepositInterface(getContractAddress("lqgNodeDeposit"));
        lqgNodeDepositInterface.increaseDepositCreditBalance(nodeAddress, userDepositBalance);
        // Remove from vacant set
        lqgMinipoolManager.removeVacantMinipool();
        // Emit event
        emit MinipoolPromoted(block.timestamp);
    }

    /// @dev Stakes the balance of this minipool into the deposit contract to set withdrawal credentials to this contract
    /// @param _validatorSignature A signature over the deposit message object
    /// @param _depositDataRoot The hash tree root of the deposit data object
    function preStake(bytes calldata _validatorPubkey, bytes calldata _validatorSignature, bytes32 _depositDataRoot) internal {
        // Load contracts
        DepositInterface casperDeposit = DepositInterface(getContractAddress("casperDeposit"));
        LQGMinipoolManagerInterface lqgMinipoolManager = LQGMinipoolManagerInterface(getContractAddress("lqgMinipoolManager"));
        // Set minipool pubkey
        lqgMinipoolManager.setMinipoolPubkey(_validatorPubkey);
        // Get withdrawal credentials
        bytes memory withdrawalCredentials = lqgMinipoolManager.getMinipoolWithdrawalCredentials(address(this));
        // Send staking deposit to casper
        casperDeposit.deposit{value : preLaunchValue}(_validatorPubkey, withdrawalCredentials, _validatorSignature, _depositDataRoot);
        // Emit event
        emit MinipoolPrestaked(_validatorPubkey, _validatorSignature, _depositDataRoot, preLaunchValue, withdrawalCredentials, block.timestamp);
    }

    /// @notice Distributes the contract's balance.
    ///         If balance is greater or equal to 8 ETH, the NO can call to distribute capital and finalise the minipool.
    ///         If balance is greater or equal to 8 ETH, users who have called `beginUserDistribute` and waited the required
    ///         amount of time can call to distribute capital.
    ///         If balance is lower than 8 ETH, can be called by anyone and is considered a partial withdrawal and funds are
    ///         split as rewards.
    /// @param _rewardsOnly If set to true, will revert if balance is not being treated as rewards
    function distributeBalance(bool _rewardsOnly) override external onlyInitialised {
        // Get node withdrawal address
        address nodeWithdrawalAddress = lqgStorage.getNodeWithdrawalAddress(nodeAddress);
        bool ownerCalling = msg.sender == nodeAddress || msg.sender == nodeWithdrawalAddress;
        // If dissolved, distribute everything to the owner
        if (status == MinipoolStatus.Dissolved) {
            require(ownerCalling, "Only owner can distribute dissolved minipool");
            distributeToOwner();
            return;
        }
        // Can only be called while in staking status
        require(status == MinipoolStatus.Staking, "Minipool must be staking");
        // Get withdrawal amount, we must also account for a possible node refund balance on the contract
        uint256 totalBalance = address(this).balance.sub(nodeRefundBalance);
        if (totalBalance >= 8 ether) {
            // Prevent funding front runs of distribute balance
            require(!_rewardsOnly, "Balance exceeds 8 ether");
            // Consider this a full withdrawal
            _distributeBalance(totalBalance);
            if (ownerCalling) {
                // Finalise the minipool if the owner is calling
                _finalise();
            } else {
                // Require user wait period to pass before allowing user to distribute
                require(userDistributeAllowed(), "Only owner can distribute right now");
                // Mark this minipool as having been distributed by a user
                userDistributed = true;
            }
        } else {
            // Just a partial withdraw
            distributeSkimmedRewards();
            // If node operator is calling, save a tx by calling refund immediately
            if (ownerCalling && nodeRefundBalance > 0) {
                _refund();
            }
        }
        // Reset distribute waiting period
        userDistributeTime = 0;
    }

    /// @dev Distribute the entire balance to the minipool owner
    function distributeToOwner() internal {
        // Get balance
        uint256 balance = address(this).balance;
        // Get node withdrawal address
        address nodeWithdrawalAddress = lqgStorage.getNodeWithdrawalAddress(nodeAddress);
        // Transfer balance
        (bool success,) = nodeWithdrawalAddress.call{value : balance}("");
        require(success, "Node ETH balance was not successfully transferred to node operator");
        // Emit ether withdrawn event
        emit EtherWithdrawn(nodeWithdrawalAddress, balance, block.timestamp);
    }

    /// @notice Allows a user (other than the owner of this minipool) to signal they want to call distribute.
    ///         After waiting the required period, anyone may then call `distributeBalance()`.
    function beginUserDistribute() override external onlyInitialised {
        require(status == MinipoolStatus.Staking, "Minipool must be staking");
        uint256 totalBalance = address(this).balance.sub(nodeRefundBalance);
        require (totalBalance >= 8 ether, "Balance too low");
        // Prevent calls resetting distribute time before window has passed
        LQGDAOProtocolSettingsMinipoolInterface lqgDAOProtocolSettingsMinipool = LQGDAOProtocolSettingsMinipoolInterface(getContractAddress("lqgDAOProtocolSettingsMinipool"));
        uint256 timeElapsed = block.timestamp.sub(userDistributeTime);
        require(lqgDAOProtocolSettingsMinipool.hasUserDistributeWindowPassed(timeElapsed), "User distribution already pending");
        // Store current time
        userDistributeTime = block.timestamp;
    }

    /// @notice Returns true if enough time has passed for a user to distribute
    function userDistributeAllowed() override public view returns (bool) {
        // Get contracts
        LQGDAOProtocolSettingsMinipoolInterface lqgDAOProtocolSettingsMinipool = LQGDAOProtocolSettingsMinipoolInterface(getContractAddress("lqgDAOProtocolSettingsMinipool"));
        // Calculate if time elapsed since call to `beginUserDistribute` is within the allowed window
        uint256 timeElapsed = block.timestamp.sub(userDistributeTime);
        return(lqgDAOProtocolSettingsMinipool.isWithinUserDistributeWindow(timeElapsed));
    }

    /// @notice Allows the owner of this minipool to finalise it after a user has manually distributed the balance
    function finalise() override external onlyMinipoolOwnerOrWithdrawalAddress(msg.sender) onlyInitialised {
        require(userDistributed, "Can only manually finalise after user distribution");
        _finalise();
    }

    /// @dev Perform any slashings, refunds, and unlock NO's stake
    function _finalise() private {
        // Get contracts
        LQGMinipoolManagerInterface lqgMinipoolManager = LQGMinipoolManagerInterface(getContractAddress("lqgMinipoolManager"));
        // Can only finalise the pool once
        require(!finalised, "Minipool has already been finalised");
        // Set finalised flag
        finalised = true;
        // If slash is required then perform it
        if (nodeSlashBalance > 0) {
            _slash();
        }
        // Refund node operator if required
        if (nodeRefundBalance > 0) {
            _refund();
        }
        // Send any left over ETH to rETH contract
        if (address(this).balance > 0) {
            // Send user amount to rETH contract
            payable(lqgTokenRETH).transfer(address(this).balance);
        }
        // Trigger a deposit of excess collateral from rETH contract to deposit pool
        LQGTokenRETHInterface(lqgTokenRETH).depositExcessCollateral();
        // Unlock node operator's RPL
        lqgMinipoolManager.incrementNodeFinalisedMinipoolCount(nodeAddress);
        lqgMinipoolManager.decrementNodeStakingMinipoolCount(nodeAddress);
    }

    /// @dev Distributes balance to user and node operator
    /// @param _balance The amount to distribute
    function _distributeBalance(uint256 _balance) private {
        // Deposit amounts
        uint256 nodeAmount = 0;
        uint256 userCapital = getUserDepositBalance();
        // Check if node operator was slashed
        if (_balance < userCapital) {
            // Only slash on first call to distribute
            if (withdrawalBlock == 0) {
                // Record shortfall for slashing
                nodeSlashBalance = userCapital.sub(_balance);
            }
        } else {
            // Calculate node's share of the balance
            nodeAmount = _calculateNodeShare(_balance);
        }
        // User amount is what's left over from node's share
        uint256 userAmount = _balance.sub(nodeAmount);
        // Pay node operator via refund
        nodeRefundBalance = nodeRefundBalance.add(nodeAmount);
        // Pay user amount to rETH contract
        if (userAmount > 0) {
            // Send user amount to rETH contract
            payable(lqgTokenRETH).transfer(userAmount);
        }
        // Save block to prevent multiple withdrawals within a few blocks
        withdrawalBlock = block.number;
        // Log it
        emit EtherWithdrawalProcessed(msg.sender, nodeAmount, userAmount, _balance, block.timestamp);
    }

    /// @notice Given a balance, this function returns what portion of it belongs to the node taking into
    /// consideration the 8 ether reward threshold, the minipool's commission rate and any penalties it may have
    /// attracted. Another way of describing this function is that if this contract's balance was
    /// `_balance + nodeRefundBalance` this function would return how much of that balance would be paid to the node
    /// operator if a distribution occurred
    /// @param _balance The balance to calculate the node share of. Should exclude nodeRefundBalance
    function calculateNodeShare(uint256 _balance) override public view returns (uint256) {
        // Sub 8 ether balance is treated as rewards
        if (_balance < 8 ether) {
            return calculateNodeRewards(nodeDepositBalance, getUserDepositBalance(), _balance);
        } else {
            return _calculateNodeShare(_balance);
        }
    }

    /// @notice Performs the same calculation as `calculateNodeShare` but on the user side
    /// @param _balance The balance to calculate the node share of. Should exclude nodeRefundBalance
    function calculateUserShare(uint256 _balance) override external view returns (uint256) {
        // User's share is just the balance minus node refund minus node's share
        return _balance.sub(calculateNodeShare(_balance));
    }

    /// @dev Given a balance, this function returns what portion of it belongs to the node taking into
    /// consideration the minipool's commission rate and any penalties it may have attracted
    /// @param _balance The balance to calculate the node share of (with nodeRefundBalance already subtracted)
    function _calculateNodeShare(uint256 _balance) internal view returns (uint256) {
        uint256 userCapital = getUserDepositBalance();
        uint256 nodeCapital = nodeDepositBalance;
        uint256 nodeShare = 0;
        // Calculate the total capital (node + user)
        uint256 capital = userCapital.add(nodeCapital);
        if (_balance > capital) {
            // Total rewards to share
            uint256 rewards = _balance.sub(capital);
            nodeShare = nodeCapital.add(calculateNodeRewards(nodeCapital, userCapital, rewards));
        } else if (_balance > userCapital) {
            nodeShare = _balance.sub(userCapital);
        }
        // Check if node has an ETH penalty
        uint256 penaltyRate = LQGMinipoolPenaltyInterface(lqgMinipoolPenalty).getPenaltyRate(address(this));
        if (penaltyRate > 0) {
            uint256 penaltyAmount = nodeShare.mul(penaltyRate).div(calcBase);
            if (penaltyAmount > nodeShare) {
                penaltyAmount = nodeShare;
            }
            nodeShare = nodeShare.sub(penaltyAmount);
        }
        return nodeShare;
    }

    /// @dev Calculates what portion of rewards should be paid to the node operator given a capital ratio
    /// @param _nodeCapital The node supplied portion of the capital
    /// @param _userCapital The user supplied portion of the capital
    /// @param _rewards The amount of rewards to split
    function calculateNodeRewards(uint256 _nodeCapital, uint256 _userCapital, uint256 _rewards) internal view returns (uint256) {
        // Calculate node and user portion based on proportions of capital provided
        uint256 nodePortion = _rewards.mul(_nodeCapital).div(_userCapital.add(_nodeCapital));
        uint256 userPortion = _rewards.sub(nodePortion);
        // Calculate final node amount as combination of node capital, node share and commission on user share
        return nodePortion.add(userPortion.mul(nodeFee).div(calcBase));
    }

    /// @notice Dissolve the minipool, returning user deposited ETH to the deposit pool.
    function dissolve() override external onlyInitialised {
        // Check current status
        require(status == MinipoolStatus.Prelaunch, "The minipool can only be dissolved while in prelaunch");
        // Load contracts
        LQGDAOProtocolSettingsMinipoolInterface lqgDAOProtocolSettingsMinipool = LQGDAOProtocolSettingsMinipoolInterface(getContractAddress("lqgDAOProtocolSettingsMinipool"));
        // Check if minipool is timed out
        require(block.timestamp.sub(statusTime) >= lqgDAOProtocolSettingsMinipool.getLaunchTimeout(), "The minipool can only be dissolved once it has timed out");
        // Perform the dissolution
        _dissolve(0);
    }

    /// @notice Withdraw node balances from the minipool and close it. Only accepts calls from the owner
    function close() override external onlyMinipoolOwner(msg.sender) onlyInitialised {
        // Check current status
        require(status == MinipoolStatus.Dissolved, "The minipool can only be closed while dissolved");
        // Distribute funds to owner
        distributeToOwner();
        // Destroy minipool
        LQGMinipoolManagerInterface lqgMinipoolManager = LQGMinipoolManagerInterface(getContractAddress("lqgMinipoolManager"));
        require(lqgMinipoolManager.getMinipoolExists(address(this)), "Minipool already closed");
        lqgMinipoolManager.destroyMinipool();
        // Clear state
        nodeDepositBalance = 0;
        nodeRefundBalance = 0;
        userDepositBalance = 0;
        userDepositBalanceLegacy = 0;
        userDepositAssignedTime = 0;
    }

    /// @notice Can be called by trusted nodes to scrub this minipool if its withdrawal credentials are not set correctly
    function voteScrub() override external onlyInitialised {
        // Check current status
        require(status == MinipoolStatus.Prelaunch, "The minipool can only be scrubbed while in prelaunch");
        // Get contracts
        LQGDAONodeTrustedInterface lqgDAONode = LQGDAONodeTrustedInterface(getContractAddress("lqgDAONodeTrusted"));
        LQGDAONodeTrustedSettingsMinipoolInterface lqgDAONodeTrustedSettingsMinipool = LQGDAONodeTrustedSettingsMinipoolInterface(getContractAddress("lqgDAONodeTrustedSettingsMinipool"));
        // Must be a trusted member
        require(lqgDAONode.getMemberIsValid(msg.sender), "Not a trusted member");
        // Can only vote once
        require(!memberScrubVotes[msg.sender], "Member has already voted to scrub");
        memberScrubVotes[msg.sender] = true;
        // Emit event
        emit ScrubVoted(msg.sender, block.timestamp);
        // Check if required quorum has voted
        uint256 quorum = lqgDAONode.getMemberCount().mul(lqgDAONodeTrustedSettingsMinipool.getScrubQuorum()).div(calcBase);
        if (totalScrubVotes.add(1) > quorum) {
            if (!vacant && lqgDAONodeTrustedSettingsMinipool.getScrubPenaltyEnabled()){
                _dissolve(scrubPenalty);
            } else {
                _dissolve(0);
            }
            // Emit event
            emit MinipoolScrubbed(block.timestamp);
        } else {
            // Increment total
            totalScrubVotes = totalScrubVotes.add(1);
        }
    }

    /// @notice Reduces the ETH bond amount and credits the owner the difference
    function reduceBondAmount() override external onlyMinipoolOwner(msg.sender) onlyInitialised {
        require(status == MinipoolStatus.Staking, "Minipool must be staking");
        // If balance is greater than 8 ether, it is assumed to be capital not skimmed rewards. So prevent reduction
        uint256 totalBalance = address(this).balance.sub(nodeRefundBalance);
        require(totalBalance < 8 ether, "Cannot reduce bond with balance of 8 ether or more");
        // Distribute any skimmed rewards
        distributeSkimmedRewards();
        // Approve reduction and handle external state changes
        LQGMinipoolBondReducerInterface lqgBondReducer = LQGMinipoolBondReducerInterface(getContractAddress("lqgMinipoolBondReducer"));
        uint256 previousBond = nodeDepositBalance;
        uint256 newBond = lqgBondReducer.reduceBondAmount();
        // Update user/node balances
        userDepositBalance = getUserDepositBalance().add(previousBond.sub(newBond));
        nodeDepositBalance = newBond;
        // Reset node fee to current network rate
        LQGNetworkFeesInterface lqgNetworkFees = LQGNetworkFeesInterface(getContractAddress("lqgNetworkFees"));
        uint256 prevFee = nodeFee;
        uint256 newFee = lqgNetworkFees.getNodeFee();
        nodeFee = newFee;
        // Update staking minipool counts and fee numerator
        LQGMinipoolManagerInterface lqgMinipoolManager = LQGMinipoolManagerInterface(getContractAddress("lqgMinipoolManager"));
        lqgMinipoolManager.updateNodeStakingMinipoolCount(previousBond, newBond, prevFee, newFee);
        // Break state to prevent rollback exploit
        if (depositType != MinipoolDeposit.Variable) {
            userDepositBalanceLegacy = 2 ** 256 - 1;
            depositType = MinipoolDeposit.Variable;
        }
        // Emit event
        emit BondReduced(previousBond, newBond, block.timestamp);
    }

    /// @dev Distributes the current contract balance based on capital ratio and node fee
    function distributeSkimmedRewards() internal {
        uint256 rewards = address(this).balance.sub(nodeRefundBalance);
        uint256 nodeShare = calculateNodeRewards(nodeDepositBalance, getUserDepositBalance(), rewards);
        // Pay node operator via refund mechanism
        nodeRefundBalance = nodeRefundBalance.add(nodeShare);
        // Deposit user share into rETH contract
        payable(lqgTokenRETH).transfer(rewards.sub(nodeShare));
    }

    /// @dev Set the minipool's current status
    /// @param _status The new status
    function setStatus(MinipoolStatus _status) private {
        // Update status
        status = _status;
        statusBlock = block.number;
        statusTime = block.timestamp;
        // Emit status updated event
        emit StatusUpdated(uint8(_status), block.timestamp);
    }

    /// @dev Transfer refunded ETH balance to the node operator
    function _refund() private {
        // Prevent vacant minipools from calling
        require(vacant == false, "Vacant minipool cannot refund");
        // Update refund balance
        uint256 refundAmount = nodeRefundBalance;
        nodeRefundBalance = 0;
        // Get node withdrawal address
        address nodeWithdrawalAddress = lqgStorage.getNodeWithdrawalAddress(nodeAddress);
        // Transfer refund amount
        (bool success,) = nodeWithdrawalAddress.call{value : refundAmount}("");
        require(success, "ETH refund amount was not successfully transferred to node operator");
        // Emit ether withdrawn event
        emit EtherWithdrawn(nodeWithdrawalAddress, refundAmount, block.timestamp);
    }

    /// @dev Slash node operator's RPL balance based on nodeSlashBalance
    function _slash() private {
        // Get contracts
        LQGNodeStakingInterface lqgNodeStaking = LQGNodeStakingInterface(getContractAddress("lqgNodeStaking"));
        // Slash required amount and reset storage value
        uint256 slashAmount = nodeSlashBalance;
        nodeSlashBalance = 0;
        lqgNodeStaking.slashRPL(nodeAddress, slashAmount);
    }

    /// @dev Dissolve this minipool
    /// @param _penalty An additional amount of ETH to send back to the deposit pool (unused for vacant minipools)
    function _dissolve(uint256 _penalty) private {
        // Get contracts
        LQGDepositPoolInterface lqgDepositPool = LQGDepositPoolInterface(getContractAddress("lqgDepositPool"));
        LQGMinipoolQueueInterface lqgMinipoolQueue = LQGMinipoolQueueInterface(getContractAddress("lqgMinipoolQueue"));
        // Progress to dissolved
        setStatus(MinipoolStatus.Dissolved);
        if (vacant) {
            // Vacant minipools waiting to be promoted need to be removed from the set maintained by the minipool manager
            LQGMinipoolManagerInterface lqgMinipoolManager = LQGMinipoolManagerInterface(getContractAddress("lqgMinipoolManager"));
            lqgMinipoolManager.removeVacantMinipool();
        } else {
            if (depositType == MinipoolDeposit.Full) {
                // Handle legacy Full type minipool
                lqgMinipoolQueue.removeMinipool(MinipoolDeposit.Full);
            } else {
                // Transfer user balance (and penalty) to deposit pool
                uint256 userCapital = getUserDepositBalance();
                lqgDepositPool.recycleDissolvedDeposit{value : userCapital + _penalty}();
                // Emit ether withdrawn event
                emit EtherWithdrawn(address(lqgDepositPool), userCapital + _penalty, block.timestamp);
            }
        }
    }
}
