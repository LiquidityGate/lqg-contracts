// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import "../../LQGBase.sol";
import "../../../interface/dao/security/LQGDAOSecurityInterface.sol";
import "../../../interface/dao/security/LQGDAOSecurityProposalsInterface.sol";
import "../../../interface/dao/protocol/settings/LQGDAOProtocolSettingsSecurityInterface.sol";
import "../../../interface/util/AddressSetStorageInterface.sol";

/// @notice The LQG Pool Security Council DAO
contract LQGDAOSecurity is LQGBase, LQGDAOSecurityInterface {

    // The namespace for any data stored in the network DAO (do not change)
    string constant internal daoNameSpace = "dao.security.";

    constructor(LQGStorageInterface _lqgStorageAddress) LQGBase(_lqgStorageAddress) {
        version = 1;
    }

    /// @notice Return the amount of member votes need for a proposal to pass (as a fraction of 1e18)
    function getMemberQuorumVotesRequired() override external view returns (uint256) {
        // Load contracts
        LQGDAOProtocolSettingsSecurityInterface lqgDAOProtocolSettingsSecurity = LQGDAOProtocolSettingsSecurityInterface(getContractAddress("lqgDAOProtocolSettingsSecurity"));
        // Calculate and return votes required
        return getMemberCount() * lqgDAOProtocolSettingsSecurity.getQuorum();
    }

    /*** Members ******************/

    /// @notice Returns whether a given address is a member
    /// @param _memberAddress Address of the member to query
    /// @return True if the node addressed passed is a member of the trusted node DAO
    function getMemberIsValid(address _memberAddress) override external view returns (bool) {
        return getBool(keccak256(abi.encodePacked(daoNameSpace, "member", _memberAddress)));
    }

    /// @notice Returns the address of a node in the member set
    /// @param _index The index into the member set
    /// @return Address of the member at the given index
    function getMemberAt(uint256 _index) override external view returns (address) {
        AddressSetStorageInterface addressSetStorage = AddressSetStorageInterface(getContractAddress("addressSetStorage"));
        return addressSetStorage.getItem(keccak256(abi.encodePacked(daoNameSpace, "member.index")), _index);
    }

    /// @notice Returns the total number of members in the set
    /// @return The number of members
    function getMemberCount() override public view returns (uint256) {
        AddressSetStorageInterface addressSetStorage = AddressSetStorageInterface(getContractAddress("addressSetStorage"));
        return addressSetStorage.getCount(keccak256(abi.encodePacked(daoNameSpace, "member.index")));
    }

    /// @notice Get the ID of a member
    /// @param _memberAddress The address of the member to query
    /// @return The ID of the relevant member
    function getMemberID(address _memberAddress) override external view returns (string memory) {
        return getString(keccak256(abi.encodePacked(daoNameSpace, "member.id", _memberAddress)));
    }

    /// @notice Get the block the member joined at
    /// @param _memberAddress The address of the member to query
    /// @return The timestamp at which the relevant member joined
    function getMemberJoinedTime(address _memberAddress) override external view returns (uint256) {
        return getUint(keccak256(abi.encodePacked(daoNameSpace, "member.joined.time", _memberAddress)));
    }

    /// @notice Get data that was recorded about a proposal that was executed
    /// @param _proposalType Can be one of the following: "invited", "leave"
    /// @param _memberAddress The address of the member to query
    /// @return The timestamp that the relevant proposal happened for the relevant member
    function getMemberProposalExecutedTime(string memory _proposalType, address _memberAddress) override external view returns (uint256) {
        return getUint(keccak256(abi.encodePacked(daoNameSpace, "member.executed.time", _proposalType, _memberAddress)));
    }
}
