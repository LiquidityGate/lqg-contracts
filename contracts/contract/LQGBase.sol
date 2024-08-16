pragma solidity >0.5.0 <0.9.0;

// SPDX-License-Identifier: GPL-3.0-only

import "../interface/LQGStorageInterface.sol";

/// @title Base settings / modifiers for each contract in LQG Pool
/// @author David Rugendyke

abstract contract LQGBase {

    // Calculate using this as the base
    uint256 constant calcBase = 1 ether;

    // Version of the contract
    uint8 public version;

    // The main storage contract where primary persistant storage is maintained
    LQGStorageInterface lqgStorage = LQGStorageInterface(address(0));


    /*** Modifiers **********************************************************/

    /**
    * @dev Throws if called by any sender that doesn't match a LQG Pool network contract
    */
    modifier onlyLatestNetworkContract() {
        require(getBool(keccak256(abi.encodePacked("contract.exists", msg.sender))), "Invalid or outdated network contract");
        _;
    }

    /**
    * @dev Throws if called by any sender that doesn't match one of the supplied contract or is the latest version of that contract
    */
    modifier onlyLatestContract(string memory _contractName, address _contractAddress) {
        require(_contractAddress == getAddress(keccak256(abi.encodePacked("contract.address", _contractName))), "Invalid or outdated contract");
        _;
    }

    /**
    * @dev Throws if called by any sender that isn't a registered node
    */
    modifier onlyRegisteredNode(address _nodeAddress) {
        require(getBool(keccak256(abi.encodePacked("node.exists", _nodeAddress))), "Invalid node");
        _;
    }

    /**
    * @dev Throws if called by any sender that isn't a trusted node DAO member
    */
    modifier onlyTrustedNode(address _nodeAddress) {
        require(getBool(keccak256(abi.encodePacked("dao.trustednodes.", "member", _nodeAddress))), "Invalid trusted node");
        _;
    }

    /**
    * @dev Throws if called by any sender that isn't a registered minipool
    */
    modifier onlyRegisteredMinipool(address _minipoolAddress) {
        require(getBool(keccak256(abi.encodePacked("minipool.exists", _minipoolAddress))), "Invalid minipool");
        _;
    }
    

    /**
    * @dev Throws if called by any account other than a guardian account (temporary account allowed access to settings before DAO is fully enabled)
    */
    modifier onlyGuardian() {
        require(msg.sender == lqgStorage.getGuardian(), "Account is not a temporary guardian");
        _;
    }




    /*** Methods **********************************************************/

    /// @dev Set the main LQG Storage address
    constructor(LQGStorageInterface _lqgStorageAddress) {
        // Update the contract address
        lqgStorage = LQGStorageInterface(_lqgStorageAddress);
    }


    /// @dev Get the address of a network contract by name
    function getContractAddress(string memory _contractName) internal view returns (address) {
        // Get the current contract address
        address contractAddress = getAddress(keccak256(abi.encodePacked("contract.address", _contractName)));
        // Check it
        require(contractAddress != address(0x0), "Contract not found");
        // Return
        return contractAddress;
    }


    /// @dev Get the address of a network contract by name (returns address(0x0) instead of reverting if contract does not exist)
    function getContractAddressUnsafe(string memory _contractName) internal view returns (address) {
        // Get the current contract address
        address contractAddress = getAddress(keccak256(abi.encodePacked("contract.address", _contractName)));
        // Return
        return contractAddress;
    }


    /// @dev Get the name of a network contract by address
    function getContractName(address _contractAddress) internal view returns (string memory) {
        // Get the contract name
        string memory contractName = getString(keccak256(abi.encodePacked("contract.name", _contractAddress)));
        // Check it
        require(bytes(contractName).length > 0, "Contract not found");
        // Return
        return contractName;
    }

    /// @dev Get revert error message from a .call method
    function getRevertMsg(bytes memory _returnData) internal pure returns (string memory) {
        // If the _res length is less than 68, then the transaction failed silently (without a revert message)
        if (_returnData.length < 68) return "Transaction reverted silently";
        assembly {
            // Slice the sighash.
            _returnData := add(_returnData, 0x04)
        }
        return abi.decode(_returnData, (string)); // All that remains is the revert string
    }



    /*** LQG Storage Methods ****************************************/

    // Note: Unused helpers have been removed to keep contract sizes down

    /// @dev Storage get methods
    function getAddress(bytes32 _key) internal view returns (address) { return lqgStorage.getAddress(_key); }
    function getUint(bytes32 _key) internal view returns (uint) { return lqgStorage.getUint(_key); }
    function getString(bytes32 _key) internal view returns (string memory) { return lqgStorage.getString(_key); }
    function getBytes(bytes32 _key) internal view returns (bytes memory) { return lqgStorage.getBytes(_key); }
    function getBool(bytes32 _key) internal view returns (bool) { return lqgStorage.getBool(_key); }
    function getInt(bytes32 _key) internal view returns (int) { return lqgStorage.getInt(_key); }
    function getBytes32(bytes32 _key) internal view returns (bytes32) { return lqgStorage.getBytes32(_key); }

    /// @dev Storage set methods
    function setAddress(bytes32 _key, address _value) internal { lqgStorage.setAddress(_key, _value); }
    function setUint(bytes32 _key, uint _value) internal { lqgStorage.setUint(_key, _value); }
    function setString(bytes32 _key, string memory _value) internal { lqgStorage.setString(_key, _value); }
    function setBytes(bytes32 _key, bytes memory _value) internal { lqgStorage.setBytes(_key, _value); }
    function setBool(bytes32 _key, bool _value) internal { lqgStorage.setBool(_key, _value); }
    function setInt(bytes32 _key, int _value) internal { lqgStorage.setInt(_key, _value); }
    function setBytes32(bytes32 _key, bytes32 _value) internal { lqgStorage.setBytes32(_key, _value); }

    /// @dev Storage delete methods
    function deleteAddress(bytes32 _key) internal { lqgStorage.deleteAddress(_key); }
    function deleteUint(bytes32 _key) internal { lqgStorage.deleteUint(_key); }
    function deleteString(bytes32 _key) internal { lqgStorage.deleteString(_key); }
    function deleteBytes(bytes32 _key) internal { lqgStorage.deleteBytes(_key); }
    function deleteBool(bytes32 _key) internal { lqgStorage.deleteBool(_key); }
    function deleteInt(bytes32 _key) internal { lqgStorage.deleteInt(_key); }
    function deleteBytes32(bytes32 _key) internal { lqgStorage.deleteBytes32(_key); }

    /// @dev Storage arithmetic methods
    function addUint(bytes32 _key, uint256 _amount) internal { lqgStorage.addUint(_key, _amount); }
    function subUint(bytes32 _key, uint256 _amount) internal { lqgStorage.subUint(_key, _amount); }
}
