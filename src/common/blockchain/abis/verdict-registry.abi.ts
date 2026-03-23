export const VERDICT_REGISTRY_ABI = [
  'function postVerdict(bytes32 sessionId, uint8 outcome, uint256 payableAmount, bytes32 metaHash, address[] calldata validatorAddrs) external',
  'function getVerdict(bytes32 sessionId) external view returns (tuple(bytes32 sessionId, uint8 outcome, uint256 payableAmount, bytes32 metaHash, address[] validators, uint256 publishedAt))',
  'event VerdictPosted(bytes32 indexed sessionId, uint8 outcome, uint256 payableAmount)',
];
