pragma solidity 0.7.6;

// SPDX-License-Identifier: GPL-3.0-only

import "../../LQGBase.sol";
import "../../../interface/LQGVaultInterface.sol";
import "../../../interface/dao/node/LQGDAONodeTrustedInterface.sol";
import "../../../interface/dao/node/LQGDAONodeTrustedActionsInterface.sol";
import "../../../interface/dao/node/settings/LQGDAONodeTrustedSettingsMembersInterface.sol";
import "../../../interface/dao/node/settings/LQGDAONodeTrustedSettingsProposalsInterface.sol";
import "../../../interface/rewards/claims/LQGClaimTrustedNodeInterface.sol";
import "../../../interface/util/AddressSetStorageInterface.sol";
import "../../../interface/util/IERC20Burnable.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";


// The Trusted Node DAO Actions
contract LQGDAONodeTrustedActions is LQGBase, LQGDAONodeTrustedActionsInterface {

    using SafeMath for uint;

    // Events
    event ActionJoined(address indexed nodeAddress, uint256 rplBondAmount, uint256 time);
    event ActionLeave(address indexed nodeAddress, uint256 rplBondAmount, uint256 time);
    event ActionKick(address indexed nodeAddress, uint256 rplBondAmount, uint256 time);
    event ActionChallengeMade(address indexed nodeChallengedAddress, address indexed nodeChallengerAddress, uint256 time);
    event ActionChallengeDecided(address indexed nodeChallengedAddress, address indexed nodeChallengeDeciderAddress, bool success, uint256 time);


    // The namespace for any data stored in the trusted node DAO (do not change)
    string constant private daoNameSpace = "dao.trustednodes.";


    // Construct
    constructor(LQGStorageInterface _lqgStorageAddress) LQGBase(_lqgStorageAddress) {
        // Version
        version = 2;
    }

    /*** Internal Methods **********************/

    // Add a new member to the DAO
    function _memberAdd(address _nodeAddress, uint256 _rplBondAmountPaid) private onlyRegisteredNode(_nodeAddress) {
        // Load contracts
        LQGDAONodeTrustedInterface lqgDAONode = LQGDAONodeTrustedInterface(getContractAddress("lqgDAONodeTrusted"));
        AddressSetStorageInterface addressSetStorage = AddressSetStorageInterface(getContractAddress("addressSetStorage"));
        // Check current node status
        require(lqgDAONode.getMemberIsValid(_nodeAddress) != true, "This node is already part of the trusted node DAO");
        // Flag them as a member now that they have accepted the invitation and record the size of the bond they paid
        setBool(keccak256(abi.encodePacked(daoNameSpace, "member", _nodeAddress)), true);
        // Add the bond amount they have paid
        if(_rplBondAmountPaid > 0) setUint(keccak256(abi.encodePacked(daoNameSpace, "member.bond.rpl", _nodeAddress)), _rplBondAmountPaid);
        // Record the block number they joined at
        setUint(keccak256(abi.encodePacked(daoNameSpace, "member.joined.time", _nodeAddress)), block.timestamp);
         // Add to member index now
        addressSetStorage.addItem(keccak256(abi.encodePacked(daoNameSpace, "member.index")), _nodeAddress); 
    }

    // Remove a member from the DAO
    function _memberRemove(address _nodeAddress) private onlyTrustedNode(_nodeAddress) {
        // Load contracts
        AddressSetStorageInterface addressSetStorage = AddressSetStorageInterface(getContractAddress("addressSetStorage"));
        // Remove their membership now
        deleteBool(keccak256(abi.encodePacked(daoNameSpace, "member", _nodeAddress)));
        deleteAddress(keccak256(abi.encodePacked(daoNameSpace, "member.address", _nodeAddress)));
        deleteString(keccak256(abi.encodePacked(daoNameSpace, "member.id", _nodeAddress)));
        deleteString(keccak256(abi.encodePacked(daoNameSpace, "member.url", _nodeAddress)));
        deleteUint(keccak256(abi.encodePacked(daoNameSpace, "member.bond.rpl", _nodeAddress)));
        deleteUint(keccak256(abi.encodePacked(daoNameSpace, "member.joined.time", _nodeAddress)));
        deleteUint(keccak256(abi.encodePacked(daoNameSpace, "member.challenged.time", _nodeAddress)));
        // Clean up the invited/leave proposals
        deleteUint(keccak256(abi.encodePacked(daoNameSpace, "member.executed.time", "invited", _nodeAddress)));
        deleteUint(keccak256(abi.encodePacked(daoNameSpace, "member.executed.time", "leave", _nodeAddress)));
         // Remove from member index now
        addressSetStorage.removeItem(keccak256(abi.encodePacked(daoNameSpace, "member.index")), _nodeAddress); 
    }

    // A member official joins the DAO with their bond ready, if successful they are added as a member
    function _memberJoin(address _nodeAddress) private {
        // Set some intiial contract address
        address lqgVaultAddress = getContractAddress("lqgVault");
        address lqgTokenRPLAddress = getContractAddress("lqgTokenRPL");
        // Load contracts
        IERC20 rplInflationContract = IERC20(lqgTokenRPLAddress);
        LQGVaultInterface lqgVault = LQGVaultInterface(lqgVaultAddress);
        LQGDAONodeTrustedInterface lqgDAONode = LQGDAONodeTrustedInterface(getContractAddress("lqgDAONodeTrusted"));
        LQGDAONodeTrustedSettingsMembersInterface lqgDAONodeTrustedSettingsMembers = LQGDAONodeTrustedSettingsMembersInterface(getContractAddress("lqgDAONodeTrustedSettingsMembers"));
        LQGDAONodeTrustedSettingsProposalsInterface lqgDAONodeTrustedSettingsProposals = LQGDAONodeTrustedSettingsProposalsInterface(getContractAddress("lqgDAONodeTrustedSettingsProposals"));
        // The time that the member was successfully invited to join the DAO
        uint256 memberInvitedTime = lqgDAONode.getMemberProposalExecutedTime("invited", _nodeAddress);
        // Have they been invited?
        require(memberInvitedTime > 0, "This node has not been invited to join");
        // The current member bond amount in RPL that's required
        uint256 rplBondAmount = lqgDAONodeTrustedSettingsMembers.getRPLBond();
        // Has their invite expired?
        require(memberInvitedTime.add(lqgDAONodeTrustedSettingsProposals.getActionTime()) > block.timestamp, "This node's invitation to join has expired, please apply again");
        // Verify they have allowed this contract to spend their RPL for the bond
        require(rplInflationContract.allowance(_nodeAddress, address(this)) >= rplBondAmount, "Not enough allowance given to LQGDAONodeTrusted contract for transfer of RPL bond tokens");
        // Transfer the tokens to this contract now
        require(rplInflationContract.transferFrom(_nodeAddress, address(this), rplBondAmount), "Token transfer to LQGDAONodeTrusted contract was not successful");
        // Allow LQGVault to transfer these tokens to itself now
        require(rplInflationContract.approve(lqgVaultAddress, rplBondAmount), "Approval for LQGVault to spend LQGDAONodeTrusted RPL bond tokens was not successful");
        // Let vault know it can move these tokens to itself now and credit the balance to this contract
        lqgVault.depositToken(getContractName(address(this)), IERC20(lqgTokenRPLAddress), rplBondAmount);
        // Add them as a member now that they have accepted the invitation and record the size of the bond they paid
        _memberAdd(_nodeAddress, rplBondAmount);
        // Log it
        emit ActionJoined(_nodeAddress, rplBondAmount, block.timestamp);
    }
  
    /*** Action Methods ************************/

    // When a new member has been successfully invited to join, they must call this method to join officially
    // They will be required to have the RPL bond amount in their account
    // This method allows us to only allow them to join if they have a working node account and have been officially invited
    function actionJoin() override external onlyRegisteredNode(msg.sender) onlyLatestContract("lqgDAONodeTrustedActions", address(this)) {
        _memberJoin(msg.sender);
    }

    // When the DAO has suffered a loss of members due to unforseen blackswan issue and has < the min required amount (3), a regular bonded node can directly join as a member and recover the DAO
    // They will be required to have the RPL bond amount in their account. This is called directly from LQGDAONodeTrusted.
    function actionJoinRequired(address _nodeAddress) override external onlyRegisteredNode(_nodeAddress) onlyLatestContract("lqgDAONodeTrusted", msg.sender) {
        _memberJoin(_nodeAddress);
    }
    
    // When a new member has successfully requested to leave with a proposal, they must call this method to leave officially and receive their RPL bond
    function actionLeave(address _rplBondRefundAddress) override external onlyTrustedNode(msg.sender) onlyLatestContract("lqgDAONodeTrustedActions", address(this)) {
        // Load contracts
        LQGVaultInterface lqgVault = LQGVaultInterface(getContractAddress("lqgVault"));
        LQGDAONodeTrustedInterface lqgDAONode = LQGDAONodeTrustedInterface(getContractAddress("lqgDAONodeTrusted"));
        LQGDAONodeTrustedSettingsProposalsInterface lqgDAONodeTrustedSettingsProposals = LQGDAONodeTrustedSettingsProposalsInterface(getContractAddress("lqgDAONodeTrustedSettingsProposals"));
        // Check this wouldn't dip below the min required trusted nodes
        require(lqgDAONode.getMemberCount() > lqgDAONode.getMemberMinRequired(), "Member count will fall below min required");
        // Get the time that they were approved to leave at
        uint256 leaveAcceptedTime = lqgDAONode.getMemberProposalExecutedTime("leave", msg.sender);
        // Has their leave request expired?
        require(leaveAcceptedTime.add(lqgDAONodeTrustedSettingsProposals.getActionTime()) > block.timestamp, "This member has not been approved to leave or request has expired, please apply to leave again");
        // They were successful, lets refund their RPL Bond
        uint256 rplBondRefundAmount = lqgDAONode.getMemberRPLBondAmount(msg.sender);
        // Refund
        if(rplBondRefundAmount > 0) {
            // Valid withdrawal address
            require(_rplBondRefundAddress != address(0x0), "Member has not supplied a valid address for their RPL bond refund");
            // Send tokens now
            lqgVault.withdrawToken(_rplBondRefundAddress, IERC20(getContractAddress("lqgTokenRPL")), rplBondRefundAmount);
        }
        // Remove them now
        _memberRemove(msg.sender);
        // Log it
        emit ActionLeave(msg.sender, rplBondRefundAmount, block.timestamp);
    }


    // A member can be evicted from the DAO by proposal, send their remaining RPL balance to them and remove from the DAO
    // Is run via the main DAO contract when the proposal passes and is executed
    function actionKick(address _nodeAddress, uint256 _rplFine) override external onlyTrustedNode(_nodeAddress) onlyLatestContract("lqgDAONodeTrustedProposals", msg.sender) {
        // Load contracts
        LQGVaultInterface lqgVault = LQGVaultInterface(getContractAddress("lqgVault"));
        LQGDAONodeTrustedInterface lqgDAONode = LQGDAONodeTrustedInterface(getContractAddress("lqgDAONodeTrusted"));
        IERC20 rplToken = IERC20(getContractAddress("lqgTokenRPL"));
        // Get the
        uint256 rplBondRefundAmount = lqgDAONode.getMemberRPLBondAmount(_nodeAddress);
        // Refund
        if (rplBondRefundAmount > 0) {
            // Send tokens now if the vault can cover it
            if(rplToken.balanceOf(address(lqgVault)) >= rplBondRefundAmount) lqgVault.withdrawToken(_nodeAddress, IERC20(getContractAddress("lqgTokenRPL")), rplBondRefundAmount);
        }
        // Burn the fine
        if (_rplFine > 0) {
            lqgVault.burnToken(IERC20Burnable(getContractAddress("lqgTokenRPL")), _rplFine);
        }
        // Remove the member now
        _memberRemove(_nodeAddress);
        // Log it
        emit ActionKick(_nodeAddress, rplBondRefundAmount, block.timestamp);   
    }


    // In the event that the majority/all of members go offline permanently and no more proposals could be passed, a current member or a regular node can 'challenge' a DAO members node to respond
    // If it does not respond in the given window, it can be removed as a member. The one who removes the member after the challenge isn't met, must be another node other than the proposer to provide some oversight
    // This should only be used in an emergency situation to recover the DAO. Members that need removing when consensus is still viable, should be done via the 'kick' method.
    function actionChallengeMake(address _nodeAddress) override external onlyTrustedNode(_nodeAddress) onlyRegisteredNode(msg.sender) onlyLatestContract("lqgDAONodeTrustedActions", address(this)) payable {
        // Load contracts
        LQGDAONodeTrustedInterface lqgDAONode = LQGDAONodeTrustedInterface(getContractAddress("lqgDAONodeTrusted"));
        LQGDAONodeTrustedSettingsMembersInterface lqgDAONodeTrustedSettingsMembers = LQGDAONodeTrustedSettingsMembersInterface(getContractAddress("lqgDAONodeTrustedSettingsMembers"));
        // Members can challenge other members for free, but for a regular bonded node to challenge a DAO member, requires non-refundable payment to prevent spamming
        if(lqgDAONode.getMemberIsValid(msg.sender) != true) require(msg.value == lqgDAONodeTrustedSettingsMembers.getChallengeCost(), "Non DAO members must pay ETH to challenge a members node");
        // Can't challenge yourself duh
        require(msg.sender != _nodeAddress, "You cannot challenge yourself");
        // Is this member already being challenged?
        require(!lqgDAONode.getMemberIsChallenged(_nodeAddress), "Member is already being challenged");
        // Has this node recently made another challenge and not waited for the cooldown to pass?
        require(getUint(keccak256(abi.encodePacked(daoNameSpace, "node.challenge.created.time", msg.sender))).add(lqgDAONodeTrustedSettingsMembers.getChallengeCooldown()) < block.timestamp, "You must wait for the challenge cooldown to pass before issuing another challenge");
        // Ok challenge accepted
        // Record the last time this member challenged
        setUint(keccak256(abi.encodePacked(daoNameSpace, "node.challenge.created.time", msg.sender)), block.timestamp);
        // Record the challenge block now
        setUint(keccak256(abi.encodePacked(daoNameSpace, "member.challenged.time", _nodeAddress)), block.timestamp);
        // Record who made the challenge
        setAddress(keccak256(abi.encodePacked(daoNameSpace, "member.challenged.by", _nodeAddress)), msg.sender);
        // Log it
        emit ActionChallengeMade(_nodeAddress, msg.sender, block.timestamp);
    }

    
    // Decides the success of a challenge. If called by the challenged node within the challenge window, the challenge is defeated and the member stays as they have indicated their node is still alive.
    // If called after the challenge window has passed by anyone except the original challenge initiator, then the challenge has succeeded and the member is removed
    function actionChallengeDecide(address _nodeAddress) override external onlyTrustedNode(_nodeAddress) onlyRegisteredNode(msg.sender) onlyLatestContract("lqgDAONodeTrustedActions", address(this)) {
        // Load contracts
        LQGDAONodeTrustedSettingsMembersInterface lqgDAONodeTrustedSettingsMembers = LQGDAONodeTrustedSettingsMembersInterface(getContractAddress("lqgDAONodeTrustedSettingsMembers"));
        // Was the challenge successful?
        bool challengeSuccess = false;
        // Get the block the challenge was initiated at
        bytes32 challengeTimeKey = keccak256(abi.encodePacked(daoNameSpace, "member.challenged.time", _nodeAddress));
        uint256 challengeTime = getUint(challengeTimeKey);
        // If challenge time is 0, the member hasn't been challenged or they have successfully responded to the challenge previously
        require(challengeTime > 0, "Member hasn't been challenged or they have successfully responded to the challenge already");
        // Allow the challenged member to refute the challenge at anytime. If the window has passed and the challenge node does not run this method, any member can decide the challenge and eject the absent member
        // Is it the node being challenged?
        if(_nodeAddress == msg.sender) {
            // Challenge is defeated, node has responded
            deleteUint(challengeTimeKey);
        }else{
            // The challenge refute window has passed, the member can be ejected now
            require(challengeTime.add(lqgDAONodeTrustedSettingsMembers.getChallengeWindow()) < block.timestamp, "Refute window has not yet passed");
            // Node has been challenged and failed to respond in the given window, remove them as a member and their bond is burned
            _memberRemove(_nodeAddress);
            // Challenge was successful
            challengeSuccess = true;
        }
        // Log it
        emit ActionChallengeDecided(_nodeAddress, msg.sender, challengeSuccess, block.timestamp);
    }


}
