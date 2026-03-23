// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValidatorRegistry.sol";
import "../src/PolicyRegistry.sol";
import "../src/VerdictRegistry.sol";
import "../src/SlashingRewards.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        ValidatorRegistry validatorRegistry = new ValidatorRegistry();
        PolicyRegistry policyRegistry = new PolicyRegistry();
        VerdictRegistry verdictRegistry = new VerdictRegistry();
        SlashingRewards slashingRewards = new SlashingRewards(
            address(validatorRegistry)
        );

        vm.stopBroadcast();

        console.log("ValidatorRegistry:", address(validatorRegistry));
        console.log("PolicyRegistry:", address(policyRegistry));
        console.log("VerdictRegistry:", address(verdictRegistry));
        console.log("SlashingRewards:", address(slashingRewards));
    }
}
