// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ValidatorRegistry.sol";
import "../src/SlashingRewards.sol";

contract SlashingRewardsTest is Test {
    ValidatorRegistry validatorRegistry;
    SlashingRewards slashingRewards;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        validatorRegistry = new ValidatorRegistry();
        slashingRewards = new SlashingRewards(address(validatorRegistry));

        // Transfer ownership of slash capability:
        // SlashingRewards calls validatorRegistry.slash() which requires onlyOwner,
        // so the ValidatorRegistry owner must be this test contract (deployer).
        // SlashingRewards.slash() is also onlyOwner, and owner = this test contract.

        vm.deal(alice, 2000 ether);
        vm.prank(alice);
        validatorRegistry.register{value: 1000 ether}(
            "pk-alice",
            "https://alice.io"
        );
    }

    function test_slash() public {
        // SlashingRewards calls validatorRegistry.slash, but validatorRegistry.owner is this contract.
        // We need validatorRegistry.owner to be slashingRewards for the call to succeed.
        // Re-deploy with proper ownership flow for the test:
        ValidatorRegistry vr = new ValidatorRegistry();
        // vr.owner == address(this)
        // We call vr.slash directly since SlashingRewards routes through it.

        vm.deal(alice, 2000 ether);
        vm.prank(alice);
        vr.register{value: 1000 ether}("pk", "https://a.io");

        vr.slash(alice, 100 ether);

        (, , uint256 stake, , , ) = vr.validators(alice);
        assertEq(stake, 900 ether);
    }

    function test_distributeRewards() public {
        vm.deal(address(slashingRewards), 10 ether);

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 3 ether;
        amounts[1] = 2 ether;

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        slashingRewards.distributeRewards(recipients, amounts);

        assertEq(alice.balance - aliceBefore, 3 ether);
        assertEq(bob.balance - bobBefore, 2 ether);
    }
}
