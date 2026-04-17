import { withRetry, isTransientError } from './retry.util';

describe('retry.util', () => {
  describe('isTransientError', () => {
    it('classifies timeout as transient', () => {
      expect(isTransientError(new Error('request timed out'))).toBe(true);
    });
    it('classifies ECONNRESET as transient', () => {
      expect(isTransientError(new Error('socket hang up ECONNRESET'))).toBe(true);
    });
    it('classifies nonce errors as transient', () => {
      expect(isTransientError(new Error('nonce too low'))).toBe(true);
    });
    it('classifies validation errors as permanent', () => {
      expect(isTransientError(new Error('invalid address'))).toBe(false);
    });
  });

  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const op = jest.fn().mockResolvedValue('ok');
      const result = await withRetry(op, { maxAttempts: 3, initialDelayMs: 1, jitter: false });
      expect(result).toBe('ok');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('retries on transient error until success', async () => {
      const op = jest
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue('ok');

      const result = await withRetry(op, { maxAttempts: 5, initialDelayMs: 1, jitter: false });
      expect(result).toBe('ok');
      expect(op).toHaveBeenCalledTimes(3);
    });

    it('throws immediately on permanent error', async () => {
      const op = jest.fn().mockRejectedValue(new Error('invalid signature'));
      await expect(
        withRetry(op, { maxAttempts: 5, initialDelayMs: 1, jitter: false }),
      ).rejects.toThrow('invalid signature');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('gives up after maxAttempts', async () => {
      const op = jest.fn().mockRejectedValue(new Error('timeout'));
      await expect(
        withRetry(op, { maxAttempts: 3, initialDelayMs: 1, jitter: false }),
      ).rejects.toThrow('timeout');
      expect(op).toHaveBeenCalledTimes(3);
    });
  });
});
