// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract VerdictRegistry {
    enum Outcome {
        Accept,
        Partial,
        Reject
    }

    struct Verdict {
        bytes32 sessionId;
        Outcome outcome;
        uint256 payableAmount;
        bytes32 metaHash;
        address[] validators;
        uint256 publishedAt;
    }

    mapping(bytes32 => Verdict) internal _verdicts;

    event VerdictPosted(
        bytes32 indexed sessionId,
        Outcome outcome,
        uint256 payableAmount
    );

    function postVerdict(
        bytes32 sessionId,
        Outcome outcome,
        uint256 payableAmount,
        bytes32 metaHash,
        address[] calldata validatorAddrs
    ) external {
        require(
            _verdicts[sessionId].publishedAt == 0,
            "Verdict already exists"
        );

        _verdicts[sessionId] = Verdict({
            sessionId: sessionId,
            outcome: outcome,
            payableAmount: payableAmount,
            metaHash: metaHash,
            validators: validatorAddrs,
            publishedAt: block.timestamp
        });

        emit VerdictPosted(sessionId, outcome, payableAmount);
    }

    function getVerdict(
        bytes32 sessionId
    ) external view returns (Verdict memory) {
        return _verdicts[sessionId];
    }
}
