import { createHash } from 'crypto';
import { backoffMs } from './webhook-signature';

/** Why a delivery ended up in the dead-letter queue. */
export enum DeadLetterReason {
  /** Every allowed attempt failed. */
  EXHAUSTED = 'exhausted',
  /** Still failing when it became too old to be useful. */
  EXPIRED = 'expired',
  /** The receiver said the endpoint is gone (410). */
  GONE = 'gone',
  /** The receiver refused the request itself; sending it again changes nothing. */
  REJECTED = 'rejected',
  /** The callback URL is not one the service may call. */
  TARGET_REFUSED = 'target_refused',
}

export type ResponseClass = 'delivered' | 'retry' | DeadLetterReason.GONE | DeadLetterReason.REJECTED;

/**
 * Statuses that say the request will never be accepted as it is. Anything
 * else that is not 2xx (5xx, 429, 408, auth errors that an operator may fix,
 * redirects) is retried.
 */
const PERMANENT_REJECTIONS = new Set([400, 413, 415, 422]);

export function classifyResponse(status: number): ResponseClass {
  if (status >= 200 && status < 300) return 'delivered';
  if (status === 410) return DeadLetterReason.GONE;
  if (PERMANENT_REJECTIONS.has(status)) return DeadLetterReason.REJECTED;
  return 'retry';
}

/**
 * Delay asked for by a Retry-After header (seconds or an HTTP date), or null
 * when there is none or it cannot be read. Dates in the past mean "now".
 */
export function parseRetryAfter(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now.getTime());
}

export interface RetryPolicy {
  baseMs: number;
  capMs: number;
  /** Share of the delay (0..1) that is randomised away, spreading out retries. */
  jitter: number;
  maxAttempts: number;
  /** Deliveries older than this are not retried any more. */
  maxAgeMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseMs: 30_000,
  capMs: 3_600_000,
  jitter: 0.2,
  maxAttempts: 5,
  maxAgeMs: 24 * 3_600_000,
};

/** Number in [0, 1) fixed per delivery and attempt, so a delay can be recomputed. */
function jitterUnit(deliveryId: string, attempt: number): number {
  return createHash('sha256').update(`${deliveryId}:${attempt}`).digest().readUInt32BE(0) / 2 ** 32;
}

/**
 * Delay before the next attempt after `attempt` failed. Exponential backoff,
 * shortened by up to `jitter` of itself so receivers that came back up are not
 * hit by every queued delivery in the same second. A Retry-After from the
 * receiver is honoured when it asks for longer, but never beyond the cap.
 */
export function nextRetryDelayMs(
  attempt: number,
  deliveryId: string,
  policy: RetryPolicy,
  retryAfterMs: number | null = null,
): number {
  const exponential = backoffMs(attempt, policy.baseMs, policy.capMs);
  const jitter = Math.min(1, Math.max(0, policy.jitter));
  const delay = Math.round(exponential * (1 - jitter * jitterUnit(deliveryId, attempt)));
  if (retryAfterMs === null) return delay;
  return Math.min(policy.capMs, Math.max(delay, retryAfterMs));
}

export interface RetryDecision {
  /** Null when the delivery goes to the dead-letter queue. */
  nextAttemptAt: Date | null;
  deadLetterReason: DeadLetterReason | null;
}

/**
 * What happens to a delivery after a failed attempt: another try at a later
 * time, or the dead-letter queue when the attempts are used up or the next try
 * would land after the delivery has expired.
 */
export function decideRetry(input: {
  attempts: number;
  deliveryId: string;
  createdAt: Date;
  now: Date;
  policy: RetryPolicy;
  retryAfterMs?: number | null;
}): RetryDecision {
  if (input.attempts >= input.policy.maxAttempts) {
    return { nextAttemptAt: null, deadLetterReason: DeadLetterReason.EXHAUSTED };
  }
  const delay = nextRetryDelayMs(input.attempts, input.deliveryId, input.policy, input.retryAfterMs);
  const next = new Date(input.now.getTime() + delay);
  if (next.getTime() - input.createdAt.getTime() > input.policy.maxAgeMs) {
    return { nextAttemptAt: null, deadLetterReason: DeadLetterReason.EXPIRED };
  }
  return { nextAttemptAt: next, deadLetterReason: null };
}
