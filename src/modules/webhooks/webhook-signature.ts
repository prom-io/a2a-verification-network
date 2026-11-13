import { createHmac, timingSafeEqual } from 'crypto';
import { isIP } from 'net';

export const SIGNATURE_HEADER = 'x-prom-signature';

/**
 * Signature sent with every webhook: `t=<unix seconds>,v1=<hex hmac>`, where
 * the HMAC-SHA256 covers `<t>.<raw body>`. Including the timestamp lets the
 * receiver reject a captured request that is replayed later.
 */
export function signPayload(secret: string, timestampSeconds: number, body: string): string {
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${digest}`;
}

/**
 * What a receiver does with the header; also used by the tests. Returns false
 * for a malformed header, a wrong signature, or a timestamp outside the
 * tolerance.
 */
export function verifySignature(
  secret: string,
  header: string | undefined,
  body: string,
  now: Date = new Date(),
  toleranceSeconds = 300,
): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(now.getTime() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = signPayload(secret, timestamp, body).split('v1=')[1];
  const given = Buffer.from(match[2], 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return given.length === wanted.length && timingSafeEqual(given, wanted);
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
