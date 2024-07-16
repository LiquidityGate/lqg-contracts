pragma solidity 0.7.6;

// SPDX-License-Identifier: GPL-3.0-only

import "../../LQGBase.sol";
import "../../../interface/LQGVaultInterface.sol";
import "../../../interface/dao/protocol/LQGDAOProtocolActionsInterface.sol";
import "../../../interface/util/IERC20Burnable.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";


// The LQG Pool Network DAO Actions - This is a placeholder for the network DAO to come
contract LQGDAOProtocolActions is LQGBase, LQGDAOProtocolActionsInterface { 

    using SafeMath for uint;

    // The namespace for any data stored in the network DAO (do not change)
    string constant daoNameSpace = "dao.protocol.";


    // Construct
    constructor(LQGStorageInterface _lqgStorageAddress) LQGBase(_lqgStorageAddress) {
        // Version
        version = 1;
    }


    /*** Action Methods ************************/

   
}
