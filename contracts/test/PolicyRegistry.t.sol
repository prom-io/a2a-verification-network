// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PolicyRegistry.sol";

contract PolicyRegistryTest is Test {
    PolicyRegistry registry;

    function setUp() public {
        registry = new PolicyRegistry();
    }

    function test_publishPolicy() public {
        bytes32 pHash = keccak256("policy-data");

        registry.publishPolicy("TestPolicy", pHash, "ipfs://meta");

        bytes32 key = keccak256(abi.encodePacked("TestPolicy", uint256(1)));
        PolicyRegistry.PolicyInfo memory info = registry.getPolicy(key);

        assertEq(info.name, "TestPolicy");
        assertEq(info.policyHash, pHash);
        assertEq(info.version, 1);
        assertEq(info.author, address(this));
    }

    function test_publishPolicy_version_increment() public {
        bytes32 pHash1 = keccak256("v1");
        bytes32 pHash2 = keccak256("v2");

        registry.publishPolicy("Versioned", pHash1, "ipfs://v1");
        registry.publishPolicy("Versioned", pHash2, "ipfs://v2");

        bytes32 key2 = keccak256(abi.encodePacked("Versioned", uint256(2)));
        PolicyRegistry.PolicyInfo memory info = registry.getPolicy(key2);

        assertEq(info.version, 2);
        assertEq(info.policyHash, pHash2);
    }
}
