// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/VerdictRegistry.sol";

contract VerdictRegistryTest is Test {
    VerdictRegistry registry;

    function setUp() public {
        registry = new VerdictRegistry();
    }

    function test_postVerdict() public {
        bytes32 sessionId = keccak256("session-1");
        bytes32 metaHash = keccak256("meta");
        address[] memory vals = new address[](2);
        vals[0] = makeAddr("v1");
        vals[1] = makeAddr("v2");

        registry.postVerdict(
            sessionId,
            VerdictRegistry.Outcome.Accept,
            1 ether,
            metaHash,
            vals
        );

        VerdictRegistry.Verdict memory v = registry.getVerdict(sessionId);
        assertEq(v.sessionId, sessionId);
        assertEq(uint256(v.outcome), uint256(VerdictRegistry.Outcome.Accept));
        assertEq(v.payableAmount, 1 ether);
        assertEq(v.validators.length, 2);
    }

    function test_postVerdict_reverts_duplicate() public {
        bytes32 sessionId = keccak256("session-dup");
        address[] memory vals = new address[](1);
        vals[0] = makeAddr("v1");

        registry.postVerdict(
            sessionId,
            VerdictRegistry.Outcome.Reject,
            0,
            bytes32(0),
            vals
        );

        vm.expectRevert("Verdict already exists");
        registry.postVerdict(
            sessionId,
            VerdictRegistry.Outcome.Accept,
            0,
            bytes32(0),
            vals
        );
    }

    function test_getVerdict() public {
        bytes32 sessionId = keccak256("session-get");
        address[] memory vals = new address[](1);
        vals[0] = makeAddr("v1");

        registry.postVerdict(
            sessionId,
            VerdictRegistry.Outcome.Partial,
            5 ether,
            keccak256("hash"),
            vals
        );

        VerdictRegistry.Verdict memory v = registry.getVerdict(sessionId);
        assertEq(v.payableAmount, 5 ether);
        assertEq(
            uint256(v.outcome),
            uint256(VerdictRegistry.Outcome.Partial)
        );
    }
}
