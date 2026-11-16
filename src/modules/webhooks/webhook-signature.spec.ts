import { createHmac } from 'crypto';
import {
  ATTEMPT_HEADER,
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  backoffMs,
  buildSignedHeaders,
  forbiddenTargetReason,
  parseSignatureHeader,
  signPayload,
  verifySignature,
  verifyWebhookRequest,
} from './webhook-signature';

const SECRET = 'whsec_test';
const BODY = JSON.stringify({ event: 'verdict.published', jobId: 'job-1' });
const NOW = new Date('2026-05-01T12:00:00.000Z');
const T = Math.floor(NOW.getTime() / 1000);

describe('webhook signatures', () => {
  it('signs the timestamp and the raw body with HMAC-SHA256', () => {
    const expected = createHmac('sha256', SECRET).update(`${T}.${BODY}`).digest('hex');

    expect(signPayload(SECRET, T, BODY)).toBe(`t=${T},v1=${expected}`);
  });

  it('verifies its own signatures', () => {
    expect(verifySignature(SECRET, signPayload(SECRET, T, BODY), BODY, NOW)).toBe(true);
  });

  it('rejects a changed body, a wrong secret and a malformed header', () => {
    const header = signPayload(SECRET, T, BODY);

    expect(verifySignature(SECRET, header, BODY.replace('job-1', 'job-2'), NOW)).toBe(false);
    expect(verifySignature('other-secret', header, BODY, NOW)).toBe(false);
    expect(verifySignature(SECRET, undefined, BODY, NOW)).toBe(false);
    expect(verifySignature(SECRET, 'v1=abc', BODY, NOW)).toBe(false);
    expect(verifySignature(SECRET, `t=${T},v1=${'0'.repeat(64)}`, BODY, NOW)).toBe(false);
  });

  it('rejects a signature replayed outside the tolerance', () => {
    const header = signPayload(SECRET, T, BODY);
    const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

    expect(verifySignature(SECRET, header, BODY, later(299))).toBe(true);
    expect(verifySignature(SECRET, header, BODY, later(301))).toBe(false);
    expect(verifySignature(SECRET, header, BODY, later(-301))).toBe(false);
    expect(verifySignature(SECRET, header, BODY, later(900), 1000)).toBe(true);
  });
});

describe('signatures during a secret rotation', () => {
  const OLD = 'whsec_old';
  const header = signPayload([SECRET, OLD], T, BODY);

  it('carries one v1 per secret, current first', () => {
    const current = createHmac('sha256', SECRET).update(`${T}.${BODY}`).digest('hex');
    const previous = createHmac('sha256', OLD).update(`${T}.${BODY}`).digest('hex');

    expect(header).toBe(`t=${T},v1=${current},v1=${previous}`);
    expect(parseSignatureHeader(header)).toEqual({ timestamp: T, signatures: [current, previous] });
  });

  it('is accepted by receivers holding either secret, and by one holding both', () => {
    expect(verifySignature(SECRET, header, BODY, NOW)).toBe(true);
    expect(verifySignature(OLD, header, BODY, NOW)).toBe(true);
    expect(verifySignature([OLD, SECRET], header, BODY, NOW)).toBe(true);
    expect(verifySignature('whsec_unrelated', header, BODY, NOW)).toBe(false);
  });

  it('refuses to sign without a secret', () => {
    expect(() => signPayload([], T, BODY)).toThrow('at least one signing secret');
  });
});

describe('parseSignatureHeader', () => {
  const hex = 'ab'.repeat(32);

  it('skips schemes it does not know and tolerates spaces', () => {
    expect(parseSignatureHeader(`t=${T}, v2=zzz, v1=${hex}`)).toEqual({
      timestamp: T,
      signatures: [hex],
    });
  });

  it.each([undefined, '', `v1=${hex}`, `t=${T}`, `t=abc,v1=${hex}`, `t=${T},v1=nothex`])(
    'returns null for %p',
    (value) => {
      expect(parseSignatureHeader(value)).toBeNull();
    },
  );
});

describe('verifyWebhookRequest', () => {
  const signature = signPayload(SECRET, T, BODY);

  it('accepts a request whose timestamp header matches the signed one', () => {
    expect(
      verifyWebhookRequest({ secrets: SECRET, signature, timestamp: String(T), body: BODY, now: NOW }),
    ).toEqual({ valid: true });
  });

  it.each([
    [{ signature: undefined }, 'missing_signature'],
    [{ signature: 'garbage' }, 'malformed_signature'],
    [{ timestamp: String(T + 1) }, 'timestamp_mismatch'],
    [{ now: new Date(NOW.getTime() + 600_000) }, 'stale_timestamp'],
    [{ body: `${BODY} ` }, 'signature_mismatch'],
    [{ secrets: ['nope', 'still-nope'] }, 'signature_mismatch'],
  ])('rejects %p with %s', (override, reason) => {
    expect(
      verifyWebhookRequest({ secrets: SECRET, signature, body: BODY, now: NOW, ...override }),
    ).toEqual({ valid: false, reason });
  });
});

describe('buildSignedHeaders', () => {
  it('signs the attempt with the time of sending and labels it', () => {
    const headers = buildSignedHeaders({
      secrets: [SECRET],
      deliveryId: 'delivery-7',
      event: 'job.failed',
      attempt: 3,
      body: BODY,
      now: NOW,
    });

    expect(headers).toMatchObject({
      'content-type': 'application/json',
      [EVENT_HEADER]: 'job.failed',
      [DELIVERY_HEADER]: 'delivery-7',
      [ATTEMPT_HEADER]: '3',
      [TIMESTAMP_HEADER]: String(T),
    });
    expect(
      verifyWebhookRequest({
        secrets: SECRET,
        signature: headers[SIGNATURE_HEADER],
        timestamp: headers[TIMESTAMP_HEADER],
        body: BODY,
        now: NOW,
      }),
    ).toEqual({ valid: true });
  });
});

describe('backoffMs', () => {
  it('doubles from thirty seconds and stops at one hour', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => backoffMs(attempt))).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000,
    ]);
    expect(backoffMs(8)).toBe(3_600_000);
    expect(backoffMs(500)).toBe(3_600_000);
    expect(backoffMs(0)).toBe(30_000);
  });
});

describe('forbiddenTargetReason', () => {
  it.each([
    'https://agent.example.org/hooks/verdict',
    'http://203.0.113.10:8080/hook',
    'https://[2001:db8::1]/hook',
    'https://172.32.0.1/hook',
  ])('allows the public target %s', (url) => {
    expect(forbiddenTargetReason(url)).toBeNull();
  });

  it.each([
    ['http://localhost:3002/jobs', 'not publicly routable'],
    ['http://api.localhost/hook', 'not publicly routable'],
    ['http://metadata.google.internal/computeMetadata/v1/', 'not publicly routable'],
    ['http://127.0.0.1/hook', 'not publicly routable'],
    ['http://10.1.2.3/hook', 'not publicly routable'],
    ['http://172.16.0.9/hook', 'not publicly routable'],
    ['http://192.168.1.1/hook', 'not publicly routable'],
    ['http://169.254.169.254/latest/meta-data', 'not publicly routable'],
    ['http://100.64.0.1/hook', 'not publicly routable'],
    ['http://0.0.0.0/hook', 'not publicly routable'],
    ['http://[::1]:8080/hook', 'not publicly routable'],
    ['http://[fd00::1]/hook', 'not publicly routable'],
    ['http://[fe80::1]/hook', 'not publicly routable'],
    ['http://[::ffff:10.0.0.1]/hook', 'not publicly routable'],
    ['ftp://example.org/file', 'unsupported protocol'],
    ['file:///etc/passwd', 'unsupported protocol'],
    ['https://user:secret@example.org/hook', 'credentials'],
    ['not a url', 'not a valid URL'],
  ])('refuses %s', (url, reason) => {
    expect(forbiddenTargetReason(url)).toContain(reason);
  });

  it('lets private targets through when allowed, but never other protocols', () => {
    expect(forbiddenTargetReason('http://127.0.0.1:9000/hook', true)).toBeNull();
    expect(forbiddenTargetReason('http://localhost/hook', true)).toBeNull();
    expect(forbiddenTargetReason('gopher://127.0.0.1/', true)).toContain('unsupported protocol');
  });
});
