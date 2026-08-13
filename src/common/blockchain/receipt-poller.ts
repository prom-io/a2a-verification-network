import { Logger } from '@nestjs/common';
import { ethers } from 'ethers';

export class TransactionDroppedError extends Error {
  constructor(txHash: string) {
    super(`Transaction ${txHash} is no longer in the mempool and was never mined`);
    this.name = 'TransactionDroppedError';
  }
}

export class ReceiptTimeoutError extends Error {
  constructor(txHash: string, waitedMs: number) {
    super(`No receipt for ${txHash} after ${waitedMs}ms`);
    this.name = 'ReceiptTimeoutError';
  }
}

export interface PollOptions {
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls for a transaction receipt with exponential backoff.
 *
 * Backoff matters because a fixed short interval hammers the RPC provider for
 * the whole block time and gets the service rate limited, which is exactly
 * when it can least afford to lose the endpoint.
 *
 * A missing receipt is ambiguous: not mined yet, or dropped. The two are told
 * apart by asking whether the node still knows the transaction — if it does
 * not, it was evicted from the mempool and waiting longer is pointless.
 */
export async function pollForReceipt(
  provider: ethers.Provider,
  txHash: string,
  options: PollOptions = {},
  logger = new Logger('ReceiptPoller'),
): Promise<ethers.TransactionReceipt> {
  const {
    timeoutMs = 180_000,
    initialDelayMs = 1_000,
    maxDelayMs = 15_000,
    random = Math.random,
    sleep = defaultSleep,
  } = options;

  const startedAt = Date.now();
  let delay = initialDelayMs;
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    attempt++;

    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) {
      if (receipt.status === 0) {
        throw new Error(`Transaction ${txHash} reverted on chain`);
      }
      return receipt;
    }

    const pending = await provider.getTransaction(txHash);
    if (!pending) {
      throw new TransactionDroppedError(txHash);
    }

    // Full jitter: without it every retry across every replica lands in the
    // same instant and the backoff achieves nothing.
    const jittered = Math.floor(random() * delay);
    logger.debug?.(`No receipt for ${txHash} yet (attempt ${attempt}), retrying in ${jittered}ms`);
    await sleep(jittered);

    delay = Math.min(delay * 2, maxDelayMs);
  }

  throw new ReceiptTimeoutError(txHash, Date.now() - startedAt);
}
