pragma solidity >0.5.0 <0.9.0;

// SPDX-License-Identifier: GPL-3.0-only

import "../../types/MinipoolDeposit.sol";

interface LQGNodeDepositInterface {
    function getNodeDepositCredit(address _nodeAddress) external view returns (uint256);
    function getNodeEthBalance(address _nodeAddress) external view returns (uint256);
    function getNodeCreditAndBalance(address _nodeAddress) external view returns (uint256);
    function getNodeUsableCreditAndBalance(address _nodeAddress) external view returns (uint256);
    function getNodeUsableCredit(address _nodeAddress) external view returns (uint256);
    function increaseDepositCreditBalance(address _nodeOperator, uint256 _amount) external;
    function depositEthFor(address _nodeAddress) external payable;
    function withdrawEth(address _nodeAddress, uint256 _amount) external;
    function deposit(uint256 _depositAmount, uint256 _minimumNodeFee, bytes calldata _validatorPubkey, bytes calldata _validatorSignature, bytes32 _depositDataRoot, uint256 _salt, address _expectedMinipoolAddress) external payable;
    function depositWithCredit(uint256 _depositAmount, uint256 _minimumNodeFee, bytes calldata _validatorPubkey, bytes calldata _validatorSignature, bytes32 _depositDataRoot, uint256 _salt, address _expectedMinipoolAddress) external payable;
    function isValidDepositAmount(uint256 _amount) external pure returns (bool);
    function getDepositAmounts() external pure returns (uint256[] memory);
    function createVacantMinipool(uint256 _bondAmount, uint256 _minimumNodeFee, bytes calldata _validatorPubkey, uint256 _salt, address _expectedMinipoolAddress, uint256 _currentBalance) external;
    function increaseEthMatched(address _nodeAddress, uint256 _amount) external;
}
