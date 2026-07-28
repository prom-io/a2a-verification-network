import { ethers } from 'ethers';
import {
  confirmationsForChain,
  ReorgError,
  waitForFinality,
} from './confirmation-policy';

type Receipt = Partial<ethers.TransactionReceipt>;

function providerStub(opts: {
  initial: Receipt | null;
  /** Receipts returned by successive waitForTransaction calls after the first. */
  reWaits?: (Receipt | null)[];
  subsequent?: (Receipt | null)[];
  head?: number;
}) {
  const queue = [...(opts.subsequent ?? [])];
  const waits = [...(opts.reWaits ?? [])];
  return {
    waitForTransaction: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(waits.length ? waits.shift() : opts.initial),
      ),
    getTransactionReceipt: jest
      .fn()
      .mockImplementation(() => Promise.resolve(queue.length ? queue.shift() : opts.initial)),
    getBlockNumber: jest.fn().mockResolvedValue(opts.head ?? 100),
  } as unknown as ethers.Provider;
}

const RECEIPT: Receipt = { status: 1, blockHash: '0xaaa', blockNumber: 90 };

describe('waitForFinality', () => {
  it('returns the receipt once it is buried deep enough', async () => {
    const provider = providerStub({ initial: RECEIPT, head: 100 });
    await expect(waitForFinality(provider, '0xtx', { confirmations: 6 })).resolves.toMatchObject(
      { blockHash: '0xaaa' },
    );
  });

  it('throws when the transaction reverted', async () => {
    const provider = providerStub({ initial: { ...RECEIPT, status: 0 } });
    await expect(
      waitForFinality(provider, '0xtx', { confirmations: 6 }),
    ).rejects.toThrow('reverted on chain');
  });

  it('throws when no receipt ever arrives', async () => {
    const provider = providerStub({ initial: null });
    await expect(
      waitForFinality(provider, '0xtx', { confirmations: 6 }),
    ).rejects.toThrow('Timed out waiting');
  });

  it('raises ReorgError when the receipt disappears after confirmation', async () => {
    // The case tx.wait(n) cannot catch: confirmed at depth n, then orphaned.
    const provider = providerStub({ initial: RECEIPT, subsequent: [null] });
    await expect(
      waitForFinality(provider, '0xtx', { confirmations: 6 }),
    ).rejects.toBeInstanceOf(ReorgError);
  });

  it('re-waits when the transaction is re-mined into a different block', async () => {
    const moved: Receipt = { status: 1, blockHash: '0xbbb', blockNumber: 95 };
    const provider = providerStub({
      initial: RECEIPT,
      reWaits: [RECEIPT, moved],
      subsequent: [moved, moved],
      head: 200,
    });

    const result = await waitForFinality(provider, '0xtx', {
      confirmations: 6,
      pollIntervalMs: 1,
    });
    expect(result.blockHash).toBe('0xbbb');
  });

  it('times out rather than blocking forever on a stalled chain', async () => {
    const provider = providerStub({ initial: RECEIPT, head: 91 });
    await expect(
      waitForFinality(provider, '0xtx', {
        confirmations: 6,
        timeoutMs: 30,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow('Timed out confirming');
  });
});

describe('confirmationsForChain', () => {
  it('uses a single confirmation on local chains', () => {
    expect(confirmationsForChain(31337)).toBe(1);
    expect(confirmationsForChain(1337)).toBe(1);
  });

  it('defaults to six elsewhere', () => {
    expect(confirmationsForChain(71234)).toBe(6);
  });

  it('honours an explicit override', () => {
    expect(confirmationsForChain(31337, 12)).toBe(12);
  });
});
