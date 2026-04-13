import { Logger } from '@nestjs/common';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULTS: Required<Omit<RetryOptions, 'shouldRetry'>> = {
  maxAttempts: 5,
  initialDelayMs: 200,
  maxDelayMs: 5_000,
  factor: 2,
  jitter: true,
};

const TRANSIENT_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /network/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /nonce too low/i,
  /replacement transaction underpriced/i,
  /could not detect network/i,
];

export function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_PATTERNS.some((p) => p.test(message));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
  logger?: Logger,
): Promise<T> {
  const opts = { ...DEFAULTS, ...options };
  const shouldRetry = options.shouldRetry ?? isTransientError;

  let attempt = 0;
  let delay = opts.initialDelayMs;
  let lastError: unknown;

  while (attempt < opts.maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= opts.maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      const wait = opts.jitter ? delay * (0.5 + Math.random()) : delay;
      logger?.warn(
        `attempt ${attempt}/${opts.maxAttempts} failed: ${(error as Error).message}; retrying in ${Math.round(wait)}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
      delay = Math.min(delay * opts.factor, opts.maxDelayMs);
    }
  }
  throw lastError;
}
