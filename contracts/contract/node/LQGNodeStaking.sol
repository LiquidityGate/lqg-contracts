// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import "../../interface/util/IERC20.sol";

import "../LQGBase.sol";
import "../../interface/minipool/LQGMinipoolManagerInterface.sol";
import "../../interface/network/LQGNetworkPricesInterface.sol";
import "../../interface/node/LQGNodeStakingInterface.sol";
import "../../interface/dao/protocol/settings/LQGDAOProtocolSettingsRewardsInterface.sol";
import "../../interface/dao/protocol/settings/LQGDAOProtocolSettingsMinipoolInterface.sol";
import "../../interface/dao/protocol/settings/LQGDAOProtocolSettingsNodeInterface.sol";
import "../../interface/LQGVaultInterface.sol";
import "../../interface/util/AddressSetStorageInterface.sol";
import "../../interface/network/LQGNetworkSnapshotsInterface.sol";
import "../network/LQGNetworkSnapshots.sol";
import "../../interface/node/LQGNodeManagerInterface.sol";
import "../../interface/network/LQGNetworkVotingInterface.sol";

/// @notice Handles node deposits and minipool creation
contract LQGNodeStaking is LQGBase, LQGNodeStakingInterface {

    // Constants
    bytes32 immutable internal totalKey;

    // Events
    event RPLStaked(address indexed from, uint256 amount, uint256 time);
    event RPLWithdrawn(address indexed to, uint256 amount, uint256 time);
    event RPLSlashed(address indexed node, uint256 amount, uint256 ethValue, uint256 time);
    event StakeRPLForAllowed(address indexed node, address indexed caller, bool allowed, uint256 time);
    event RPLLockingAllowed(address indexed node, bool allowed, uint256 time);
    event RPLLocked(address indexed from, uint256 amount, uint256 time);
    event RPLUnlocked(address indexed from, uint256 amount, uint256 time);
    event RPLTransferred(address indexed from, address indexed to, uint256 amount, uint256 time);
    event RPLBurned(address indexed from, uint256 amount, uint256 time);

    modifier onlyRPLWithdrawalAddressOrNode(address _nodeAddress) {
        // Check that the call is coming from RPL withdrawal address (or node if unset)
        LQGNodeManagerInterface lqgNodeManager = LQGNodeManagerInterface(getContractAddress("lqgNodeManager"));
        if (lqgNodeManager.getNodeRPLWithdrawalAddressIsSet(_nodeAddress)) {
            address rplWithdrawalAddress = lqgNodeManager.getNodeRPLWithdrawalAddress(_nodeAddress);
            require(msg.sender == rplWithdrawalAddress, "Must be called from RPL withdrawal address");
        } else {
            require(msg.sender == _nodeAddress, "Must be called from node address");
        }
        _;
    }

    constructor(LQGStorageInterface _lqgStorageAddress) LQGBase(_lqgStorageAddress) {
        version = 6;

        // Precompute keys
        totalKey = keccak256(abi.encodePacked("rpl.staked.total.amount"));
    }

    /// @notice Returns the total quantity of RPL staked on the network
    function getTotalRPLStake() override external view returns (uint256) {
        return getUint(totalKey);
    }

    /// @dev Increases the total network RPL stake
    /// @param _amount How much to increase by
    function increaseTotalRPLStake(uint256 _amount) private {
        addUint(totalKey, _amount);
    }

    /// @dev Decrease the total network RPL stake
    /// @param _amount How much to decrease by
    function decreaseTotalRPLStake(uint256 _amount) private {
        subUint(totalKey, _amount);
    }

    /// @notice Returns the amount a given node operator has staked
    /// @param _nodeAddress The address of the node operator to query
    function getNodeRPLStake(address _nodeAddress) override public view returns (uint256) {
        bytes32 key = keccak256(abi.encodePacked("rpl.staked.node.amount", _nodeAddress));
        LQGNetworkSnapshotsInterface lqgNetworkSnapshots = LQGNetworkSnapshotsInterface(getContractAddress("lqgNetworkSnapshots"));
        (bool exists,, uint224 value) = lqgNetworkSnapshots.latest(key);
        uint256 stake = uint256(value);
        if (!exists){
            // Fallback to old value
            stake = getUint(key);
        }
        return stake;
    }

    /// @dev Increases a node operator's RPL stake
    /// @param _amount How much to increase by
    function increaseNodeRPLStake(address _nodeAddress, uint256 _amount) private {
        LQGNetworkSnapshotsInterface lqgNetworkSnapshots = LQGNetworkSnapshotsInterface(getContractAddress("lqgNetworkSnapshots"));
        bytes32 key = keccak256(abi.encodePacked("rpl.staked.node.amount", _nodeAddress));
        (bool exists,, uint224 value) = lqgNetworkSnapshots.latest(key);
        if (!exists){
            value = uint224(getUint(key));
        }
        lqgNetworkSnapshots.push(key, value + uint224(_amount));
    }

    /// @dev Decrease a node operator's RPL stake
    /// @param _amount How much to decrease by
    function decreaseNodeRPLStake(address _nodeAddress, uint256 _amount) private {
        LQGNetworkSnapshotsInterface lqgNetworkSnapshots = LQGNetworkSnapshotsInterface(getContractAddress("lqgNetworkSnapshots"));
        bytes32 key = keccak256(abi.encodePacked("rpl.staked.node.amount", _nodeAddress));
        (bool exists,, uint224 value) = lqgNetworkSnapshots.latest(key);
        if (!exists){
            value = uint224(getUint(key));
        }
        lqgNetworkSnapshots.push(key, value - uint224(_amount));
    }

    /// @notice Returns a node's matched ETH amount (amount taken from protocol to stake)
    /// @param _nodeAddress The address of the node operator to query
    function getNodeETHMatched(address _nodeAddress) override public view returns (uint256) {
        LQGNetworkSnapshotsInterface lqgNetworkSnapshots = LQGNetworkSnapshotsInterface(getContractAddress("lqgNetworkSnapshots"));
        bytes32 key = keccak256(abi.encodePacked("eth.matched.node.amount", _nodeAddress));
        (bool exists, , uint224 value) = lqgNetworkSnapshots.latest(key);
        if (exists) {
            // Value was previously set in a snapshot so return that
            return value;
        } else {
            // Fallback to old method
            uint256 ethMatched = getUint(key);
            if (ethMatched > 0) {
                // Value was previously calculated and stored so return that
                return ethMatched;
            } else {
                // Fallback for backwards compatibility before ETH matched was recorded (all legacy minipools matched 16 ETH from protocol)
                LQGMinipoolManagerInterface lqgMinipoolManager = LQGMinipoolManagerInterface(getContractAddress("lqgMinipoolManager"));
                return lqgMinipoolManager.getNodeActiveMinipoolCount(_nodeAddress) * 16 ether;
            }
        }
    }

    /// @notice Returns a node's provided ETH amount (amount supplied to create minipools)
    /// @param _nodeAddress The address of the node operator to query
    function getNodeETHProvided(address _nodeAddress) override public view returns (uint256) {
        // Get contracts
        LQGMinipoolManagerInterface lqgMinipoolManager = LQGMinipoolManagerInterface(getContractAddress("lqgMinipoolManager"));
        uint256 activeMinipoolCount = lqgMinipoolManager.getNodeActiveMinipoolCount(_nodeAddress);
        // Retrieve stored ETH matched value
        uint256 ethMatched = getNodeETHMatched(_nodeAddress);
        if (ethMatched > 0) {
            LQGDAOProtocolSettingsMinipoolInterface lqgDAOProtocolSettingsMinipool = LQGDAOProtocolSettingsMinipoolInterface(getContractAddress("lqgDAOProtocolSettingsMinipool"));
            uint256 launchAmount = lqgDAOProtocolSettingsMinipool.getLaunchBalance();
            // ETH provided is number of staking minipools * 32 - eth matched
            uint256 totalEthStaked = activeMinipoolCount * launchAmount;
            return totalEthStaked - ethMatched;
        } else {
            // Fallback for legacy minipools is number of staking minipools * 16
            return activeMinipoolCount * 16 ether;
        }
    }

    /// @notice Returns the ratio between capital taken from users and provided by a node operator.
    ///         The value is a 1e18 precision fixed point integer value of (node capital + user capital) / node capital.
    /// @param _nodeAddress The address of the node operator to query
    function getNodeETHCollateralisationRatio(address _nodeAddress) override public view returns (uint256) {
        uint256 ethMatched = getNodeETHMatched(_nodeAddress);
        if (ethMatched == 0) {
            // Node operator only has legacy minipools and all legacy minipools had a 1:1 ratio
            return calcBase * 2;
        } else {
            LQGDAOProtocolSettingsMinipoolInterface lqgDAOProtocolSettingsMinipool = LQGDAOProtocolSettingsMinipoolInterface(getContractAddress("lqgDAOProtocolSettingsMinipool"));
            uint256 launchAmount = lqgDAOProtocolSettingsMinipool.getLaunchBalance();
            LQGMinipoolManagerInterface lqgMinipoolManager = LQGMinipoolManagerInterface(getContractAddress("lqgMinipoolManager"));
            uint256 totalEthStaked = lqgMinipoolManager.getNodeActiveMinipoolCount(_nodeAddress) * launchAmount;
            return (totalEthStaked * calcBase) / (totalEthStaked - ethMatched);
        }
    }

    /// @notice Returns the timestamp at which a node last staked RPL
    function getNodeRPLStakedTime(address _nodeAddress) override public view returns (uint256) {
        return getUint(keccak256(abi.encodePacked("rpl.staked.node.time", _nodeAddress)));
    }

    /// @dev Sets the timestamp at which a node last staked RPL
    /// @param _nodeAddress The address of the node operator to set the value for
    /// @param _time The timestamp to set
    function setNodeRPLStakedTime(address _nodeAddress, uint256 _time) private {
        setUint(keccak256(abi.encodePacked("rpl.staked.node.time", _nodeAddress)), _time);
    }

    /// @notice Calculate and return a node's effective RPL stake amount
    /// @param _nodeAddress The address of the node operator to calculate for
    function getNodeEffectiveRPLStake(address _nodeAddress) override public view returns (uint256) {
        // Load contracts
        LQGNetworkPricesInterface lqgNetworkPrices = LQGNetworkPricesInterface(getContractAddress("lqgNetworkPrices"));
        LQGDAOProtocolSettingsNodeInterface lqgDAOProtocolSettingsNode = LQGDAOProtocolSettingsNodeInterface(getContractAddress("lqgDAOProtocolSettingsNode"));
        // Get node's current RPL stake
        uint256 rplStake = getNodeRPLStake(_nodeAddress);
        // Retrieve variables for calculations
        uint256 matchedETH = getNodeETHMatched(_nodeAddress);
        uint256 providedETH = getNodeETHProvided(_nodeAddress);
        uint256 rplPrice = lqgNetworkPrices.getRPLPrice();
        // RPL stake cannot exceed maximum
        uint256 maximumStakePercent = lqgDAOProtocolSettingsNode.getMaximumPerMinipoolStake();
        uint256 maximumStake = providedETH * maximumStakePercent / rplPrice;
        if (rplStake > maximumStake) {
            return maximumStake;
        }
        // If RPL stake is lower than minimum, node has no effective stake
        uint256 minimumStakePercent = lqgDAOProtocolSettingsNode.getMinimumPerMinipoolStake();
        uint256 minimumStake = matchedETH * minimumStakePercent / rplPrice;
        if (rplStake < minimumStake) {
            return 0;
        }
        // Otherwise, return the actual stake
        return rplStake;
    }

    /// @notice Calculate and return a node's minimum RPL stake to collateralize their minipools
    /// @param _nodeAddress The address of the node operator to calculate for
    function getNodeMinimumRPLStake(address _nodeAddress) override external view returns (uint256) {
        // Load contracts
        LQGNetworkPricesInterface lqgNetworkPrices = LQGNetworkPricesInterface(getContractAddress("lqgNetworkPrices"));
        LQGDAOProtocolSettingsNodeInterface lqgDAOProtocolSettingsNode = LQGDAOProtocolSettingsNodeInterface(getContractAddress("lqgDAOProtocolSettingsNode"));
        // Retrieve variables
        uint256 minimumStakePercent = lqgDAOProtocolSettingsNode.getMinimumPerMinipoolStake();
        uint256 matchedETH = getNodeETHMatched(_nodeAddress);
        return matchedETH * minimumStakePercent / lqgNetworkPrices.getRPLPrice();
    }

    /// @notice Calculate and return a node's maximum RPL stake to fully collateralise their minipools
    /// @param _nodeAddress The address of the node operator to calculate for
    function getNodeMaximumRPLStake(address _nodeAddress) override public view returns (uint256) {
        // Load contracts
        LQGNetworkPricesInterface lqgNetworkPrices = LQGNetworkPricesInterface(getContractAddress("lqgNetworkPrices"));
        LQGDAOProtocolSettingsNodeInterface lqgDAOProtocolSettingsNode = LQGDAOProtocolSettingsNodeInterface(getContractAddress("lqgDAOProtocolSettingsNode"));
        // Retrieve variables
        uint256 maximumStakePercent = lqgDAOProtocolSettingsNode.getMaximumPerMinipoolStake();
        uint256 providedETH = getNodeETHProvided(_nodeAddress);
        return providedETH * maximumStakePercent / lqgNetworkPrices.getRPLPrice();
    }

    /// @notice Calculate and return a node's limit of how much user ETH they can use based on RPL stake
    /// @param _nodeAddress The address of the node operator to calculate for
    function getNodeETHMatchedLimit(address _nodeAddress) override external view returns (uint256) {
        // Load contracts
        LQGDAOProtocolSettingsNodeInterface lqgDAOProtocolSettingsNode = LQGDAOProtocolSettingsNodeInterface(getContractAddress("lqgDAOProtocolSettingsNode"));
        // Retrieve minimum stake parameter
        uint256 minimumStakePercent = lqgDAOProtocolSettingsNode.getMinimumPerMinipoolStake();
        // When minimum stake is zero, allow unlimited amount of matched ETH
        if (minimumStakePercent == 0) {
            return type(uint256).max;
        }
        // Calculate and return limit
        LQGNetworkPricesInterface lqgNetworkPrices = LQGNetworkPricesInterface(getContractAddress("lqgNetworkPrices"));
        return getNodeRPLStake(_nodeAddress) *lqgNetworkPrices.getRPLPrice() / minimumStakePercent;
    }

    /// @notice Returns whether this node allows RPL locking or not
    /// @param _nodeAddress The address of the node operator to query for
    function getRPLLockingAllowed(address _nodeAddress) external view returns (bool) {
        return getBool(keccak256(abi.encodePacked("rpl.locking.allowed", _nodeAddress)));
    }

    /// @notice Accept an RPL stake from the node operator's own address
    ///         Requires the node's RPL withdrawal address to be unset
    /// @param _amount The amount of RPL to stake
    function stakeRPL(uint256 _amount) override external {
        stakeRPLFor(msg.sender, _amount);
    }

    /// @notice Accept an RPL stake from any address for a specified node
    ///         Requires caller to have approved this contract to spend RPL
    ///         Requires caller to be on the node operator's allow list (see `setStakeForAllowed`)
    /// @param _nodeAddress The address of the node operator to stake on behalf of
    /// @param _amount The amount of RPL to stake
    function stakeRPLFor(address _nodeAddress, uint256 _amount) override public onlyLatestContract("lqgNodeStaking", address(this)) onlyRegisteredNode(_nodeAddress) {
        // Must be node's RPL withdrawal address if set or the node's address or an allow listed address or lqgMerkleDistributorMainnet
        if (msg.sender != getAddress(keccak256(abi.encodePacked("contract.address", "lqgMerkleDistributorMainnet")))) {
            LQGNodeManagerInterface lqgNodeManager = LQGNodeManagerInterface(getContractAddress("lqgNodeManager"));
            bool fromNode = false;
            if (lqgNodeManager.getNodeRPLWithdrawalAddressIsSet(_nodeAddress)) {
                address rplWithdrawalAddress = lqgNodeManager.getNodeRPLWithdrawalAddress(_nodeAddress);
                fromNode = msg.sender == rplWithdrawalAddress;
            } else {
                address withdrawalAddress = lqgStorage.getNodeWithdrawalAddress(_nodeAddress);
                fromNode = (msg.sender == _nodeAddress) || (msg.sender == withdrawalAddress);
            }
            if (!fromNode) {
                require(getBool(keccak256(abi.encodePacked("node.stake.for.allowed", _nodeAddress, msg.sender))), "Not allowed to stake for");
            }
        }
        _stakeRPL(_nodeAddress, _amount);
    }

    /// @notice Sets the allow state for this node to perform functions that require locking RPL
    /// @param _nodeAddress The address of the node operator to change the state for
    /// @param _allowed Whether locking is allowed or not
    function setRPLLockingAllowed(address _nodeAddress, bool _allowed) override external onlyLatestContract("lqgNodeStaking", address(this)) onlyRPLWithdrawalAddressOrNode(_nodeAddress) {
        // Set the value
        setBool(keccak256(abi.encodePacked("rpl.locking.allowed", _nodeAddress)), _allowed);
        // Log it
        emit RPLLockingAllowed(_nodeAddress, _allowed, block.timestamp);
    }

    /// @notice Explicitly allow or remove allowance of an address to be able to stake on behalf of a node
    /// @dev The node operator is determined by the address calling this method, it is here for backwards compatibility
    /// @param _caller The address you wish to allow
    /// @param _allowed Whether the address is allowed or denied
    function setStakeRPLForAllowed(address _caller, bool _allowed) override external {
        setStakeRPLForAllowed(msg.sender, _caller, _allowed);
    }

    /// @notice Explicitly allow or remove allowance of an address to be able to stake on behalf of a node
    /// @param _nodeAddress The address of the node operator allowing the caller
    /// @param _caller The address you wish to allow
    /// @param _allowed Whether the address is allowed or denied
    function setStakeRPLForAllowed(address _nodeAddress, address _caller, bool _allowed) override public onlyLatestContract("lqgNodeStaking", address(this)) onlyRPLWithdrawalAddressOrNode(_nodeAddress) {
        // Set the value
        setBool(keccak256(abi.encodePacked("node.stake.for.allowed", _nodeAddress, _caller)), _allowed);
        // Log it
        emit StakeRPLForAllowed(_nodeAddress, _caller, _allowed, block.timestamp);
    }

    /// @dev Internal logic for staking RPL
    /// @param _nodeAddress The address to increase the RPL stake of
    /// @param _amount The amount of RPL to stake
    function _stakeRPL(address _nodeAddress, uint256 _amount) internal {
        // Ensure voting has been initialised for this node
        LQGNetworkVotingInterface lqgNetworkVoting = LQGNetworkVotingInterface(getContractAddress("lqgNetworkVoting"));
        lqgNetworkVoting.initialiseVotingFor(_nodeAddress);
        // Load contracts
        address rplTokenAddress = getContractAddress("lqgTokenRPL");
        address lqgVaultAddress = getContractAddress("lqgVault");
        IERC20 rplToken = IERC20(rplTokenAddress);
        LQGVaultInterface lqgVault = LQGVaultInterface(lqgVaultAddress);
        // Transfer RPL tokens
        require(rplToken.transferFrom(msg.sender, address(this), _amount), "Could not transfer RPL to staking contract");
        // Deposit RPL tokens to vault
        require(rplToken.approve(lqgVaultAddress, _amount), "Could not approve vault RPL deposit");
        lqgVault.depositToken("lqgNodeStaking", rplToken, _amount);
        // Update RPL stake amounts & node RPL staked block
        increaseTotalRPLStake(_amount);
        increaseNodeRPLStake(_nodeAddress, _amount);
        setNodeRPLStakedTime(_nodeAddress, block.timestamp);
        // Emit RPL staked event
        emit RPLStaked(_nodeAddress, _amount, block.timestamp);
    }

    /// @notice Returns the amount of RPL that is locked for a given node
    /// @param _nodeAddress The address of the node operator to query for
    function getNodeRPLLocked(address _nodeAddress) override public view returns (uint256) {
        return getUint(keccak256(abi.encodePacked("rpl.locked.node.amount", _nodeAddress)));
    }

    /// @notice Locks an amount of RPL from being withdrawn even if the node operator is over capitalised
    /// @param _nodeAddress The address of the node operator
    /// @param _amount The amount of RPL to lock
    function lockRPL(address _nodeAddress, uint256 _amount) override external onlyLatestContract("lqgNodeStaking", address(this)) onlyLatestNetworkContract() {
        // Check status
        require(getBool(keccak256(abi.encodePacked("rpl.locking.allowed", _nodeAddress))), "Node is not allowed to lock RPL");
        // The node must have unlocked stake equaling or greater than the amount
        uint256 rplStake = getNodeRPLStake(_nodeAddress);
        bytes32 lockedStakeKey = keccak256(abi.encodePacked("rpl.locked.node.amount", _nodeAddress));
        uint256 lockedStake = getUint(lockedStakeKey);
        require(rplStake - lockedStake >= _amount, "Not enough staked RPL");
        // Increase locked RPL
        setUint(lockedStakeKey, lockedStake + _amount);
        // Emit event
        emit RPLLocked(_nodeAddress, _amount, block.timestamp);
    }

    /// @notice Unlocks an amount of RPL making it possible to withdraw if the nod is over capitalised
    /// @param _nodeAddress The address of the node operator
    /// @param _amount The amount of RPL to unlock
    function unlockRPL(address _nodeAddress, uint256 _amount) override external onlyLatestContract("lqgNodeStaking", address(this)) onlyLatestNetworkContract() {
        // The node must have locked stake equaling or greater than the amount
        bytes32 lockedStakeKey = keccak256(abi.encodePacked("rpl.locked.node.amount", _nodeAddress));
        uint256 lockedStake = getUint(lockedStakeKey);
        require(_amount <= lockedStake, "Not enough locked RPL");
        // Decrease locked RPL
        setUint(lockedStakeKey, lockedStake - _amount);
        // Emit event
        emit RPLUnlocked(_nodeAddress, _amount, block.timestamp);
    }

    /// @notice Transfers RPL from one node to another
    /// @param _from The node to transfer from
    /// @param _to The node to transfer to
    /// @param _amount The amount of RPL to transfer
    function transferRPL(address _from, address _to, uint256 _amount) override external onlyLatestContract("lqgNodeStaking", address(this)) onlyLatestNetworkContract() onlyRegisteredNode(_from) {
        // Check sender has enough RPL
        require(getNodeRPLStake(_from) >= _amount, "Sender has insufficient RPL");
        // Transfer the stake
        decreaseNodeRPLStake(_from, _amount);
        increaseNodeRPLStake(_to, _amount);
        // Emit event
        emit RPLTransferred(_from, _to, _amount, block.timestamp);
    }

    /// @notice Burns an amount of RPL staked by a given node operator
    /// @param _from The node to burn from
    /// @param _amount The amount of RPL to burn
    function burnRPL(address _from, uint256 _amount) override external onlyLatestContract("lqgNodeStaking", address(this)) onlyLatestNetworkContract() onlyRegisteredNode(_from) {
        // Check sender has enough RPL
        require(getNodeRPLStake(_from) >= _amount, "Node has insufficient RPL");
        // Decrease the stake amount
        decreaseTotalRPLStake(_amount);
        decreaseNodeRPLStake(_from, _amount);
        // Withdraw the RPL to this contract
        IERC20Burnable rplToken = IERC20Burnable(getContractAddress("lqgTokenRPL"));
        LQGVaultInterface lqgVault = LQGVaultInterface(getContractAddress("lqgVault"));
        lqgVault.withdrawToken(address(this), rplToken, _amount);
        // Execute the token burn
        rplToken.burn(_amount);
        // Emit event
        emit RPLBurned(_from, _amount, block.timestamp);
    }

    /// @notice Withdraw staked RPL back to the node account or withdraw RPL address
    ///         Can only be called by a node if they have not set their RPL withdrawal address
    /// @param _amount The amount of RPL to withdraw
    function withdrawRPL(uint256 _amount) override external {
        withdrawRPL(msg.sender, _amount);
    }

    /// @notice Withdraw staked RPL back to the node account or withdraw RPL address
    ///         If RPL withdrawal address has been set, must be called from it. Otherwise, must be called from
    ///         node's primary withdrawal address or their node address.
    /// @param _nodeAddress The address of the node withdrawing
    /// @param _amount The amount of RPL to withdraw
    function withdrawRPL(address _nodeAddress, uint256 _amount) override public onlyLatestContract("lqgNodeStaking", address(this)) {
        // Check valid node
        require(getBool(keccak256(abi.encodePacked("node.exists", _nodeAddress))), "Invalid node");
        // Check address is permitted to withdraw
        LQGNodeManagerInterface lqgNodeManager = LQGNodeManagerInterface(getContractAddress("lqgNodeManager"));
        address rplWithdrawalAddress = lqgNodeManager.getNodeRPLWithdrawalAddress(_nodeAddress);
        if (lqgNodeManager.getNodeRPLWithdrawalAddressIsSet(_nodeAddress)) {
            // If RPL withdrawal address is set, must be called from it
            require(msg.sender == rplWithdrawalAddress, "Invalid caller");
        } else {
            // Otherwise, must be called from node address or withdrawal address
            address withdrawalAddress = lqgStorage.getNodeWithdrawalAddress(_nodeAddress);
            require(msg.sender == _nodeAddress || msg.sender == withdrawalAddress, "Invalid caller");
        }
        // Load contracts
        LQGDAOProtocolSettingsRewardsInterface lqgDAOProtocolSettingsRewards = LQGDAOProtocolSettingsRewardsInterface(getContractAddress("lqgDAOProtocolSettingsRewards"));
        LQGVaultInterface lqgVault = LQGVaultInterface(getContractAddress("lqgVault"));
        // Check cooldown period (one claim period) has passed since RPL last staked
        require(block.timestamp - getNodeRPLStakedTime(_nodeAddress) >= lqgDAOProtocolSettingsRewards.getRewardsClaimIntervalTime(), "The withdrawal cooldown period has not passed");
        // Get & check node's current RPL stake
        uint256 rplStake = getNodeRPLStake(_nodeAddress);
        uint256 lockedStake = getNodeRPLLocked(_nodeAddress);
        require(rplStake - lockedStake >= _amount, "Withdrawal amount exceeds node's staked RPL balance");
        // Check withdrawal would not under collateralise node
        require(rplStake - _amount >= getNodeMaximumRPLStake(_nodeAddress) + lockedStake, "Node's staked RPL balance after withdrawal is less than required balance");
        // Update RPL stake amounts
        decreaseTotalRPLStake(_amount);
        decreaseNodeRPLStake(_nodeAddress, _amount);
        // Transfer RPL tokens to node's RPL withdrawal address (if unset, defaults to primary withdrawal address)
        lqgVault.withdrawToken(rplWithdrawalAddress, IERC20(getContractAddress("lqgTokenRPL")), _amount);
        // Emit RPL withdrawn event
        emit RPLWithdrawn(_nodeAddress, _amount, block.timestamp);
    }

    /// @notice Slash a node's RPL by an ETH amount
    ///         Only accepts calls from registered minipools
    /// @param _nodeAddress The address to slash RPL from
    /// @param _ethSlashAmount The amount of RPL to slash denominated in ETH value
    function slashRPL(address _nodeAddress, uint256 _ethSlashAmount) override external onlyLatestContract("lqgNodeStaking", address(this)) onlyRegisteredMinipool(msg.sender) {
        // Load contracts
        LQGNetworkPricesInterface lqgNetworkPrices = LQGNetworkPricesInterface(getContractAddress("lqgNetworkPrices"));
        LQGVaultInterface lqgVault = LQGVaultInterface(getContractAddress("lqgVault"));
        // Calculate RPL amount to slash
        uint256 rplSlashAmount = calcBase * _ethSlashAmount / lqgNetworkPrices.getRPLPrice();
        // Cap slashed amount to node's RPL stake
        uint256 rplStake = getNodeRPLStake(_nodeAddress);
        if (rplSlashAmount > rplStake) { rplSlashAmount = rplStake; }
        // Transfer slashed amount to auction contract
        if(rplSlashAmount > 0) lqgVault.transferToken("lqgAuctionManager", IERC20(getContractAddress("lqgTokenRPL")), rplSlashAmount);
        // Update RPL stake amounts
        decreaseTotalRPLStake(rplSlashAmount);
        decreaseNodeRPLStake(_nodeAddress, rplSlashAmount);
        // Mark minipool as slashed
        setBool(keccak256(abi.encodePacked("minipool.rpl.slashed", msg.sender)), true);
        // Emit RPL slashed event
        emit RPLSlashed(_nodeAddress, rplSlashAmount, _ethSlashAmount, block.timestamp);
    }

}
