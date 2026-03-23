// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PolicyRegistry {
    struct PolicyInfo {
        string name;
        bytes32 policyHash;
        string metadataUri;
        uint256 version;
        address author;
        uint256 createdAt;
    }

    mapping(bytes32 => PolicyInfo) public policies;

    event PolicyPublished(
        bytes32 indexed policyKey,
        string name,
        address indexed author,
        uint256 version
    );

    function publishPolicy(
        string calldata name,
        bytes32 policyHash,
        string calldata metadataUri
    ) external {
        uint256 version = 1;
        bytes32 key = keccak256(abi.encodePacked(name, version));

        while (policies[key].createdAt != 0) {
            version++;
            key = keccak256(abi.encodePacked(name, version));
        }

        policies[key] = PolicyInfo({
            name: name,
            policyHash: policyHash,
            metadataUri: metadataUri,
            version: version,
            author: msg.sender,
            createdAt: block.timestamp
        });

        emit PolicyPublished(key, name, msg.sender, version);
    }

    function getPolicy(
        bytes32 key
    ) external view returns (PolicyInfo memory) {
        return policies[key];
    }
}
