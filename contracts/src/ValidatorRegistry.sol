// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ValidatorRegistry {
    address public owner;

    struct ValidatorInfo {
        address addr;
        string publicKey;
        uint256 stake;
        string endpoint;
        bool active;
        uint256 registeredAt;
    }

    mapping(address => ValidatorInfo) public validators;
    uint256 public minStake = 1000 ether;

    event ValidatorRegistered(address indexed validator, uint256 stake);
    event ValidatorExited(address indexed validator, uint256 stakeReturned);
    event ValidatorSlashed(address indexed validator, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function register(
        string calldata publicKey,
        string calldata endpoint
    ) external payable {
        require(msg.value >= minStake, "Insufficient stake");
        require(!validators[msg.sender].active, "Already registered");

        validators[msg.sender] = ValidatorInfo({
            addr: msg.sender,
            publicKey: publicKey,
            stake: msg.value,
            endpoint: endpoint,
            active: true,
            registeredAt: block.timestamp
        });

        emit ValidatorRegistered(msg.sender, msg.value);
    }

    function exit() external {
        ValidatorInfo storage info = validators[msg.sender];
        require(info.active, "Not active");

        info.active = false;
        uint256 stakeAmount = info.stake;
        info.stake = 0;

        (bool sent, ) = msg.sender.call{value: stakeAmount}("");
        require(sent, "Stake return failed");

        emit ValidatorExited(msg.sender, stakeAmount);
    }

    function slash(address validator, uint256 amount) external onlyOwner {
        ValidatorInfo storage info = validators[validator];
        require(info.active, "Not active");
        require(info.stake >= amount, "Slash exceeds stake");

        info.stake -= amount;
        emit ValidatorSlashed(validator, amount);
    }

    function getValidator(
        address addr
    ) external view returns (ValidatorInfo memory) {
        return validators[addr];
    }

    receive() external payable {}
}
