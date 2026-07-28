import { Logger } from '@nestjs/common';
import { ethers } from 'ethers';

const NONCE_ERRORS = [
  'nonce too low',
  'nonce has already been used',
  'replacement transaction underpriced',
  'already known',
];

function isNonceError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error).toLowerCase();
  return NONCE_ERRORS.some((needle) => message.includes(needle));
}

/**
 * Serialises transaction submission for a single wallet.
 *
 * Verdicts are published from one hot wallet, and two of them submitted
 * concurrently both read the same pending nonce from the node and collide —
 * one is silently replaced, so a verdict that the service logged as published
 * never reached the chain.
 *
 * Submissions are therefore queued: the nonce is assigned locally and handed
 * out one at a time. On a nonce error the local counter is resynced from the
 * node and the send is retried, which covers the case of another process
 * sharing the same key.
 */
export class NonceManager {
  private readonly logger: Logger;
  private queue: Promise<unknown> = Promise.resolve();
  private next: number | null = null;

  constructor(
    private readonly signer: ethers.Signer,
    logger?: Logger,
  ) {
    this.logger = logger ?? new Logger(NonceManager.name);
  }

  /**
   * Runs `send` with an explicit nonce, one submission at a time.
   * Rejections propagate to the caller but never break the queue.
   */
  async submit<T>(
    send: (nonce: number) => Promise<T>,
    retries = 2,
  ): Promise<T> {
    const run = this.queue.then(
      () => this.attempt(send, retries),
      () => this.attempt(send, retries),
    );
    // Swallow on the chained copy only: the caller still sees the rejection,
    // while the queue continues with the next submission.
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Forces the next submission to re-read the nonce from the node. */
  reset(): void {
    this.next = null;
  }

  private async attempt<T>(
    send: (nonce: number) => Promise<T>,
    retries: number,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const nonce = await this.reserve();
      try {
        const result = await send(nonce);
        this.next = nonce + 1;
        return result;
      } catch (error) {
        if (!isNonceError(error) || attempt >= retries) {
          // Unknown failure: the local counter may no longer match the node.
          this.reset();
          throw error;
        }
        this.logger.warn(
          `Nonce ${nonce} rejected (${(error as Error).message}), resyncing from node`,
        );
        this.reset();
      }
    }
  }

  private async reserve(): Promise<number> {
    if (this.next === null) {
      // 'pending' rather than 'latest': transactions already in the mempool
      // hold nonces that 'latest' does not know about yet.
      this.next = await this.signer.getNonce('pending');
    }
    return this.next;
  }
}
