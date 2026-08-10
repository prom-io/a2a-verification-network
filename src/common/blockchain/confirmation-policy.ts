import { Logger } from '@nestjs/common';
import { ethers } from 'ethers';

export class ReorgError extends Error {
  constructor(txHash: string) {
    super(`Transaction ${txHash} was dropped by a reorg before finalisation`);
    this.name = 'ReorgError';
  }
}

export interface ConfirmationOptions {
  /** Blocks required on top of the including block before treating it as final. */
  confirmations: number;
  /** Give up after this long rather than blocking a request forever. */
  timeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * Waits for a transaction to be buried under enough blocks to be final, and
 * re-checks that it is still on the canonical chain once it is.
 *
 * `tx.wait(n)` is not sufficient on its own: it resolves as soon as the
 * confirmation count is reached, but a receipt observed at depth n can still
 * be orphaned. A verdict treated as final and then reorged out means the
 * payment rail settles against a verdict that no longer exists on chain, so
 * the receipt is fetched again at the end and the block hash compared.
 */
export async function waitForFinality(
  provider: ethers.Provider,
  txHash: string,
  options: ConfirmationOptions,
  logger = new Logger('ConfirmationPolicy'),
): Promise<ethers.TransactionReceipt> {
  const { confirmations, timeoutMs = 300_000, pollIntervalMs = 4_000 } = options;
  const deadline = Date.now() + timeoutMs;

  const initial = await provider.waitForTransaction(txHash, confirmations, timeoutMs);
  if (!initial) {
    throw new Error(`Timed out waiting for ${confirmations} confirmations of ${txHash}`);
  }
  if (initial.status === 0) {
    throw new Error(`Transaction ${txHash} reverted on chain`);
  }

  const observedBlockHash = initial.blockHash;

  while (Date.now() < deadline) {
    const current = await provider.getTransactionReceipt(txHash);

    // Receipt gone entirely: the transaction was reorged out of the chain.
    if (!current) {
      throw new ReorgError(txHash);
    }

    // Same transaction, different block: it was re-mined elsewhere, so the
    // confirmation count restarts from that block.
    if (current.blockHash !== observedBlockHash) {
      logger.warn(
        `${txHash} moved from block ${observedBlockHash} to ${current.blockHash}, re-waiting`,
      );
      return waitForFinality(
        provider,
        txHash,
        { confirmations, timeoutMs: deadline - Date.now(), pollIntervalMs },
        logger,
      );
    }

    const head = await provider.getBlockNumber();
    if (head - current.blockNumber >= confirmations) {
      return current;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timed out confirming ${txHash} to ${confirmations} blocks`);
}

/**
 * Confirmation depth per network. Local chains have no reorgs, so waiting on
 * anvil would only make every test slower.
 */
export function confirmationsForChain(chainId: number, configured?: number): number {
  if (configured && Number.isFinite(configured)) return configured;
  const LOCAL = [31337, 1337];
  return LOCAL.includes(chainId) ? 1 : 6;
}
