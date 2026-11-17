import {
  DEFAULT_RETRY_POLICY,
  DeadLetterReason,
  RetryPolicy,
  classifyResponse,
  decideRetry,
  nextRetryDelayMs,
  parseRetryAfter,
} from './webhook-retry';

const NOW = new Date('2026-05-01T12:00:00.000Z');
const NO_JITTER: RetryPolicy = { ...DEFAULT_RETRY_POLICY, jitter: 0 };

describe('classifyResponse', () => {
  it.each([200, 201, 202, 204, 299])('treats %i as delivered', (status) => {
    expect(classifyResponse(status)).toBe('delivered');
  });

  it.each([301, 302, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504])('retries %i', (status) => {
    expect(classifyResponse(status)).toBe('retry');
  });

  it('dead-letters a gone endpoint and requests the receiver refuses outright', () => {
    expect(classifyResponse(410)).toBe(DeadLetterReason.GONE);
    for (const status of [400, 413, 415, 422]) {
      expect(classifyResponse(status)).toBe(DeadLetterReason.REJECTED);
    }
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('120', NOW)).toBe(120_000);
    expect(parseRetryAfter(' 5 ', NOW)).toBe(5_000);
    expect(parseRetryAfter('Fri, 01 May 2026 12:10:00 GMT', NOW)).toBe(600_000);
  });

  it('treats a date in the past as now and ignores what it cannot read', () => {
    expect(parseRetryAfter('Fri, 01 May 2026 11:00:00 GMT', NOW)).toBe(0);
    expect(parseRetryAfter('soon', NOW)).toBeNull();
    expect(parseRetryAfter('', NOW)).toBeNull();
    expect(parseRetryAfter(null, NOW)).toBeNull();
    expect(parseRetryAfter(undefined, NOW)).toBeNull();
  });
});

describe('nextRetryDelayMs', () => {
  it('is the plain exponential backoff without jitter', () => {
    expect([1, 2, 3, 4].map((attempt) => nextRetryDelayMs(attempt, 'd', NO_JITTER))).toEqual([
      30_000, 60_000, 120_000, 240_000,
    ]);
    expect(nextRetryDelayMs(20, 'd', NO_JITTER)).toBe(3_600_000);
  });

  it('shortens each delay by at most the jitter share, the same way every time', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, jitter: 0.2 };
    for (let i = 0; i < 50; i++) {
      const delay = nextRetryDelayMs(3, `delivery-${i}`, policy);
      expect(delay).toBeGreaterThanOrEqual(96_000);
      expect(delay).toBeLessThanOrEqual(120_000);
      expect(nextRetryDelayMs(3, `delivery-${i}`, policy)).toBe(delay);
    }
  });

  it('waits longer when Retry-After asks for it, but not past the cap', () => {
    expect(nextRetryDelayMs(1, 'd', NO_JITTER, 300_000)).toBe(300_000);
    expect(nextRetryDelayMs(1, 'd', NO_JITTER, 5_000)).toBe(30_000);
    expect(nextRetryDelayMs(1, 'd', NO_JITTER, 86_400_000)).toBe(3_600_000);
  });

  it('clamps a jitter outside 0..1', () => {
    expect(nextRetryDelayMs(1, 'd', { ...NO_JITTER, jitter: -3 })).toBe(30_000);
    expect(nextRetryDelayMs(1, 'd', { ...NO_JITTER, jitter: 7 })).toBeLessThanOrEqual(30_000);
  });
});

describe('decideRetry', () => {
  const base = { deliveryId: 'd', createdAt: NOW, policy: NO_JITTER };

  it('schedules the next attempt while attempts and age allow it', () => {
    expect(decideRetry({ ...base, attempts: 1, now: NOW })).toEqual({
      nextAttemptAt: new Date(NOW.getTime() + 30_000),
      deadLetterReason: null,
    });
  });

  it('dead-letters once the attempts are used up', () => {
    expect(decideRetry({ ...base, attempts: 5, now: NOW })).toEqual({
      nextAttemptAt: null,
      deadLetterReason: DeadLetterReason.EXHAUSTED,
    });
  });

  it('dead-letters when the next attempt would come after the maximum age', () => {
    const policy = { ...NO_JITTER, maxAttempts: 100, maxAgeMs: 3_600_000 };
    const now = new Date(NOW.getTime() + 3_500_000);

    expect(decideRetry({ ...base, policy, attempts: 1, now })).toEqual({
      nextAttemptAt: new Date(now.getTime() + 30_000),
      deadLetterReason: null,
    });
    expect(decideRetry({ ...base, policy, attempts: 3, now }).deadLetterReason).toBe(
      DeadLetterReason.EXPIRED,
    );
  });
});
