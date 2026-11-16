import { createHmac, timingSafeEqual } from 'crypto';
import { isIP } from 'net';

export const SIGNATURE_HEADER = 'x-prom-signature';
export const TIMESTAMP_HEADER = 'x-prom-timestamp';
export const DELIVERY_HEADER = 'x-prom-delivery';
export const EVENT_HEADER = 'x-prom-event';
export const ATTEMPT_HEADER = 'x-prom-attempt';

/** Seconds a receiver should accept a signature for, either side of its clock. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

function hmacHex(secret: string, timestampSeconds: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
}

/**
 * Signature sent with every webhook: `t=<unix seconds>,v1=<hex hmac>`, where
 * the HMAC-SHA256 covers `<t>.<raw body>`. Including the timestamp lets the
 * receiver reject a captured request that is replayed later.
 *
 * While a secret is being rotated the header carries one `v1` per secret
 * (`t=..,v1=<new>,v1=<old>`), so receivers that still hold the old secret
 * keep accepting deliveries until they have switched.
 */
export function signPayload(
  secrets: string | readonly string[],
  timestampSeconds: number,
  body: string,
): string {
  const list = typeof secrets === 'string' ? [secrets] : secrets;
  if (list.length === 0) throw new Error('at least one signing secret is required');
  const parts = list.map((secret) => `v1=${hmacHex(secret, timestampSeconds, body)}`);
  return [`t=${timestampSeconds}`, ...parts].join(',');
}

export interface ParsedSignature {
  timestamp: number;
  signatures: string[];
}

/**
 * Splits a signature header into its timestamp and v1 values. Unknown schemes
 * (a future `v2=`) are skipped rather than rejected, so receivers keep working
 * when another scheme is added next to v1.
 */
export function parseSignatureHeader(header: string | undefined): ParsedSignature | null {
  if (!header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 't' && /^\d+$/.test(value ?? '')) timestamp = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/.test(value ?? '')) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * What a receiver does with the header; also used by the tests. Returns false
 * for a malformed header, a wrong signature, or a timestamp outside the
 * tolerance. Any of the given secrets may match any of the v1 values.
 */
export function verifySignature(
  secrets: string | readonly string[],
  header: string | undefined,
  body: string,
  now: Date = new Date(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  return verifyWebhookRequest({ secrets, signature: header, body, now, toleranceSeconds }).valid;
}

export type VerificationFailure =
  | 'missing_signature'
  | 'malformed_signature'
  | 'timestamp_mismatch'
  | 'stale_timestamp'
  | 'signature_mismatch';

export interface WebhookRequestCheck {
  secrets: string | readonly string[];
  /** Value of the x-prom-signature header. */
  signature: string | undefined;
  /** Value of the x-prom-timestamp header, when the receiver reads it. */
  timestamp?: string;
  /** The raw body exactly as received, before any JSON parsing. */
  body: string;
  now?: Date;
  toleranceSeconds?: number;
}

/**
 * Full receiver-side check with the reason for a rejection, which is what a
 * receiver wants to log. The separate timestamp header is a convenience for
 * routing and logging; when present it has to agree with the signed one.
 */
export function verifyWebhookRequest(
  check: WebhookRequestCheck,
): { valid: true } | { valid: false; reason: VerificationFailure } {
  if (!check.signature) return { valid: false, reason: 'missing_signature' };
  const parsed = parseSignatureHeader(check.signature);
  if (!parsed) return { valid: false, reason: 'malformed_signature' };
  if (check.timestamp !== undefined && check.timestamp !== String(parsed.timestamp)) {
    return { valid: false, reason: 'timestamp_mismatch' };
  }
  const now = check.now ?? new Date();
  const tolerance = check.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now.getTime() / 1000 - parsed.timestamp) > tolerance) {
    return { valid: false, reason: 'stale_timestamp' };
  }

  const secrets = typeof check.secrets === 'string' ? [check.secrets] : check.secrets;
  const given = parsed.signatures.map((hex) => Buffer.from(hex, 'hex'));
  for (const secret of secrets) {
    const wanted = Buffer.from(hmacHex(secret, parsed.timestamp, check.body), 'hex');
    // Every candidate is compared in constant time; the loop only reveals how
    // many secrets and signatures there are, which is not a secret.
    if (given.some((candidate) => candidate.length === wanted.length && timingSafeEqual(candidate, wanted))) {
      return { valid: true };
    }
  }
  return { valid: false, reason: 'signature_mismatch' };
}

export interface SignedHeaderInput {
  secrets: readonly string[];
  deliveryId: string;
  event: string;
  attempt: number;
  body: string;
  now: Date;
}

/**
 * Headers of one delivery attempt. The signature is computed per attempt with
 * the time of sending, so a retry an hour later is not rejected as stale.
 */
export function buildSignedHeaders(input: SignedHeaderInput): Record<string, string> {
  const timestamp = Math.floor(input.now.getTime() / 1000);
  return {
    'content-type': 'application/json',
    'user-agent': 'prom-verification-network-webhooks',
    [EVENT_HEADER]: input.event,
    [DELIVERY_HEADER]: input.deliveryId,
    [ATTEMPT_HEADER]: String(input.attempt),
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: signPayload(input.secrets, timestamp, input.body),
  };
}

/**
 * Delay before retry number `attempt` (1-based: the delay after the first
 * failure): 30 s, 1 min, 2 min, ... capped at one hour.
 */
export function backoffMs(attempt: number, baseMs = 30_000, capMs = 3_600_000): number {
  const exponent = Math.max(0, Math.trunc(attempt) - 1);
  return Math.min(capMs, baseMs * 2 ** Math.min(exponent, 30));
}

function isPrivateIPv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIPv6(host: string): boolean {
  const address = host.toLowerCase();
  if (address === '::' || address === '::1') return true;
  if (address.startsWith('::ffff:')) {
    const mapped = address.slice('::ffff:'.length);
    return isIP(mapped) === 4 ? isPrivateIPv4(mapped) : true;
  }
  return /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
}

/**
 * Why a callback URL must not be called, or null when it may be.
 *
 * The URL comes from whoever submits a job, and the request is made from
 * inside the service network, so loopback, link-local and private ranges are
 * refused unless explicitly allowed (local development, tests). This looks at
 * the URL only; a hostname that resolves to a private address is a matter for
 * the egress firewall.
 */
export function forbiddenTargetReason(url: string, allowPrivate = false): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'not a valid URL';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `unsupported protocol ${parsed.protocol}`;
  }
  if (parsed.username || parsed.password) return 'credentials in the URL are not allowed';
  if (allowPrivate) return null;

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return `host ${host} is not publicly routable`;
  }
  const version = isIP(host);
  if ((version === 4 && isPrivateIPv4(host)) || (version === 6 && isPrivateIPv6(host))) {
    return `address ${host} is not publicly routable`;
  }
  return null;
}
