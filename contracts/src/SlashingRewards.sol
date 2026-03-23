// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ValidatorRegistry.sol";

contract SlashingRewards {
    address public owner;
    ValidatorRegistry public validatorRegistry;

    event Slashed(address indexed validator, uint256 amount, string reason);
    event RewardsDistributed(address[] recipients, uint256[] amounts);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _validatorRegistry) {
        owner = msg.sender;
        validatorRegistry = ValidatorRegistry(payable(_validatorRegistry));
    }

    function slash(
        address validator,
        uint256 amount,
        string calldata reason
    ) external onlyOwner {
        validatorRegistry.slash(validator, amount);
        emit Slashed(validator, amount, reason);
    }

    function distributeRewards(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner {
        require(recipients.length == amounts.length, "Length mismatch");

        for (uint256 i = 0; i < recipients.length; i++) {
            (bool sent, ) = recipients[i].call{value: amounts[i]}("");
            require(sent, "Transfer failed");
        }

        emit RewardsDistributed(recipients, amounts);
    }

    receive() external payable {}
}
