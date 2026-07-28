// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValidatorRegistry.sol";
import "../src/PolicyRegistry.sol";
import "../src/VerdictRegistry.sol";
import "../src/SlashingRewards.sol";

/// @notice Testnet deployment of the verification stack.
/// @dev Emits one `KEY=0x...` line per contract so the infra deploy script can
///      parse addresses out of the broadcast log without reading JSON artifacts.
contract DeployTestnet is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        uint256 expectedChainId = vm.envUint("PROM_TESTNET_CHAIN_ID");

        require(
            block.chainid == expectedChainId,
            "DeployTestnet: refusing to deploy, chain id does not match PROM_TESTNET_CHAIN_ID"
        );

        vm.startBroadcast(deployerKey);

        ValidatorRegistry validatorRegistry = new ValidatorRegistry();
        PolicyRegistry policyRegistry = new PolicyRegistry();
        VerdictRegistry verdictRegistry = new VerdictRegistry();
        SlashingRewards slashingRewards = new SlashingRewards(
            address(validatorRegistry)
        );

        vm.stopBroadcast();

        console.log("VALIDATOR_REGISTRY_ADDRESS=%s", address(validatorRegistry));
        console.log("POLICY_REGISTRY_ADDRESS=%s", address(policyRegistry));
        console.log("VERDICT_REGISTRY_ADDRESS=%s", address(verdictRegistry));
        console.log("SLASHING_REWARDS_ADDRESS=%s", address(slashingRewards));
        console.log("DEPLOYED_CHAIN_ID=%s", block.chainid);
        console.log("DEPLOYED_BLOCK=%s", block.number);
    }
}
