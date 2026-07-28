import { ethers } from 'ethers';

/**
 * Verdict flow against a fork of the PROM testnet.
 *
 * Skipped unless FORK_RPC_URL is set, so ordinary CI runs are unaffected. Point
 * it at `anvil --fork-url $PROM_TESTNET_RPC_URL` to exercise the real deployed
 * contracts with real state, which is the only way to catch a verdict that
 * encodes fine locally and reverts against the deployed ABI.
 *
 *   anvil --fork-url https://rpc.testnet.prom.io &
 *   FORK_RPC_URL=http://127.0.0.1:8545 npm run test:e2e -- testnet-fork
 */

const FORK_RPC_URL = process.env.FORK_RPC_URL;
const VERDICT_REGISTRY = process.env.VERDICT_REGISTRY_ADDRESS;

const describeFork = FORK_RPC_URL && VERDICT_REGISTRY ? describe : describe.skip;

const VERDICT_REGISTRY_MINIMAL_ABI = [
  'function postVerdict(bytes32 sessionId, uint8 outcome, uint256 payableAmount, bytes32 metaHash, address[] validators)',
  'function getVerdict(bytes32 sessionId) view returns (uint8 outcome, uint256 payableAmount, bytes32 metaHash)',
];

describeFork('verdict flow against a testnet fork', () => {
  let provider: ethers.JsonRpcProvider;
  let signer: ethers.Wallet;
  let registry: ethers.Contract;

  beforeAll(async () => {
    provider = new ethers.JsonRpcProvider(FORK_RPC_URL);

    // Anvil's first default account is funded on a fork; a real key is never
    // needed and must never be used here.
    signer = new ethers.Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      provider,
    );
    registry = new ethers.Contract(
      VERDICT_REGISTRY as string,
      VERDICT_REGISTRY_MINIMAL_ABI,
      signer,
    );
  }, 60_000);

  it('is forked from a chain that already has the registry deployed', async () => {
    const code = await provider.getCode(VERDICT_REGISTRY as string);
    expect(code).not.toBe('0x');
  }, 60_000);

  it('publishes a verdict and reads back the same values', async () => {
    const sessionId = ethers.keccak256(
      ethers.toUtf8Bytes(`fork-session-${Date.now()}`),
    );
    const metaHash = ethers.keccak256(ethers.toUtf8Bytes('fork-meta'));
    const payable = ethers.parseEther('1.5');

    const tx = await registry.postVerdict(
      sessionId,
      0,
      payable,
      metaHash,
      [await signer.getAddress()],
    );
    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);

    const [outcome, amount, storedMeta] = await registry.getVerdict(sessionId);
    expect(Number(outcome)).toBe(0);
    expect(amount).toBe(payable);
    expect(storedMeta).toBe(metaHash);
  }, 120_000);

  it('rejects a duplicate verdict for the same session', async () => {
    const sessionId = ethers.keccak256(
      ethers.toUtf8Bytes(`fork-dup-${Date.now()}`),
    );
    const metaHash = ethers.keccak256(ethers.toUtf8Bytes('fork-meta'));

    await (
      await registry.postVerdict(sessionId, 0, 0n, metaHash, [
        await signer.getAddress(),
      ])
    ).wait();

    await expect(
      registry.postVerdict(sessionId, 0, 0n, metaHash, [await signer.getAddress()]),
    ).rejects.toThrow();
  }, 120_000);
});
