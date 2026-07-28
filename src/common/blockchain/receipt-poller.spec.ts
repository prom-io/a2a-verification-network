import { ethers } from 'ethers';
import {
  pollForReceipt,
  ReceiptTimeoutError,
  TransactionDroppedError,
} from './receipt-poller';

type Receipt = Partial<ethers.TransactionReceipt>;

function providerStub(receipts: (Receipt | null)[], knownInMempool = true) {
  const queue = [...receipts];
  return {
    getTransactionReceipt: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(queue.length ? queue.shift() : receipts[receipts.length - 1]),
      ),
    getTransaction: jest
      .fn()
      .mockResolvedValue(knownInMempool ? ({ hash: '0xtx' } as unknown) : null),
  } as unknown as ethers.Provider;
}

const OK: Receipt = { status: 1, blockNumber: 12 };
const sleep = () => Promise.resolve();
const options = { sleep, random: () => 1, initialDelayMs: 1, maxDelayMs: 4 };

describe('pollForReceipt', () => {
  it('returns immediately when the receipt is already there', async () => {
    await expect(
      pollForReceipt(providerStub([OK]), '0xtx', options),
    ).resolves.toMatchObject({ status: 1 });
  });

  it('keeps polling until the receipt appears', async () => {
    const provider = providerStub([null, null, OK]);
    await expect(pollForReceipt(provider, '0xtx', options)).resolves.toMatchObject({
      status: 1,
    });
    expect(provider.getTransactionReceipt).toHaveBeenCalledTimes(3);
  });

  it('throws when the transaction reverted', async () => {
    await expect(
      pollForReceipt(providerStub([{ status: 0 }]), '0xtx', options),
    ).rejects.toThrow('reverted on chain');
  });

  it('stops early when the transaction was dropped from the mempool', async () => {
    // Waiting longer for a transaction the node has forgotten is pointless.
    const provider = providerStub([null], false);
    await expect(pollForReceipt(provider, '0xtx', options)).rejects.toBeInstanceOf(
      TransactionDroppedError,
    );
    expect(provider.getTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it('times out rather than polling forever', async () => {
    await expect(
      pollForReceipt(providerStub([null]), '0xtx', {
        ...options,
        timeoutMs: 0,
      }),
    ).rejects.toBeInstanceOf(ReceiptTimeoutError);
  });

  it('backs off exponentially up to the ceiling', async () => {
    const waits: number[] = [];
    const provider = providerStub([null, null, null, null, null, OK]);

    await pollForReceipt(provider, '0xtx', {
      initialDelayMs: 1,
      maxDelayMs: 4,
      random: () => 1,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([1, 2, 4, 4, 4]);
  });

  it('applies jitter so replicas do not retry in lockstep', async () => {
    const waits: number[] = [];
    await pollForReceipt(providerStub([null, OK]), '0xtx', {
      initialDelayMs: 100,
      random: () => 0.25,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([25]);
  });
});
