// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ValidatorRegistry.sol";

contract ValidatorRegistryTest is Test {
    ValidatorRegistry registry;
    address alice = makeAddr("alice");

    function setUp() public {
        registry = new ValidatorRegistry();
        vm.deal(alice, 2000 ether);
    }

    function test_register() public {
        vm.prank(alice);
        registry.register{value: 1000 ether}("pk-alice", "https://alice.io");

        (
            address addr,
            ,
            uint256 stake,
            ,
            bool active,

        ) = registry.validators(alice);

        assertEq(addr, alice);
        assertEq(stake, 1000 ether);
        assertTrue(active);
    }

    function test_register_reverts_low_stake() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient stake");
        registry.register{value: 100 ether}("pk-alice", "https://alice.io");
    }

    function test_exit() public {
        vm.startPrank(alice);
        registry.register{value: 1000 ether}("pk-alice", "https://alice.io");

        uint256 balBefore = alice.balance;
        registry.exit();
        uint256 balAfter = alice.balance;
        vm.stopPrank();

        assertEq(balAfter - balBefore, 1000 ether);

        (, , , , bool active, ) = registry.validators(alice);
        assertFalse(active);
    }

    function test_slash() public {
        vm.prank(alice);
        registry.register{value: 1000 ether}("pk-alice", "https://alice.io");

        registry.slash(alice, 200 ether);

        (, , uint256 stake, , , ) = registry.validators(alice);
        assertEq(stake, 800 ether);
    }
}
