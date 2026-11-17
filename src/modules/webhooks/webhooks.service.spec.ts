import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Verdict, VerdictOutcome } from '../verdicts/entities/verdict.entity';
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEvent,
} from './entities/webhook-delivery.entity';
import { WebhookHttpClient } from './webhook-http.client';
import { DeadLetterReason } from './webhook-retry';
import { verifySignature, verifyWebhookRequest } from './webhook-signature';
import { WebhooksService } from './webhooks.service';

const NOW = new Date('2026-05-01T12:00:00.000Z');
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
const SECRET = 'whsec_unit';

const job = { id: 'job-1', sessionId: 'session-1', callbackUrl: 'https://agent.example.org/hook' };
const verdict = {
  id: 'verdict-1',
  outcome: VerdictOutcome.ACCEPT,
  payableAmount: '0',
  metaHash: '0xmeta',
  signatures: ['v1', 'v2'],
  txHash: '0xtx',
} as Verdict & { txHash?: string };

/** Lets the background attempt started by enqueue run to completion. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function build(env: Record<string, unknown> = {}) {
  const rows: WebhookDelivery[] = [];
  const repo = {
    create: jest.fn((data: Partial<WebhookDelivery>) => ({ ...data }) as WebhookDelivery),
    save: jest.fn(async (delivery: WebhookDelivery) => {
      if (!delivery.id) {
        delivery.id = `delivery-${rows.length + 1}`;
        delivery.createdAt = NOW;
        rows.push(delivery);
      }
      return delivery;
    }),
    find: jest.fn(
      async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        const ids = where.id as { value?: string[] } | undefined;
        return rows
          .filter(
            (row) =>
              (where.jobId === undefined || row.jobId === where.jobId) &&
              (where.status === undefined || row.status === where.status) &&
              (ids === undefined || (ids.value ?? []).includes(row.id)),
          )
          .slice(0, take ?? rows.length);
      },
    ),
    findOneBy: jest.fn(async ({ id }: { id: string }) => rows.find((row) => row.id === id) ?? null),
  };
  const http = { post: jest.fn().mockResolvedValue({ status: 204 }) };
  // Jitter off unless a test turns it on, so delays can be asserted exactly.
  const settings: Record<string, unknown> = {
    WEBHOOK_SIGNING_SECRET: SECRET,
    WEBHOOK_BACKOFF_JITTER: 0,
    ...env,
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => settings[key] ?? fallback),
  };
  const service = new WebhooksService(
    repo as unknown as Repository<WebhookDelivery>,
    http as unknown as WebhookHttpClient,
    config as unknown as ConfigService,
  );
  return { service, rows, http, repo };
}

describe('WebhooksService notifications', () => {
  it('does nothing for a job without a callback URL', async () => {
    const { service, rows, http } = build();

    expect(await service.notifyVerdict({ ...job, callbackUrl: null }, verdict)).toBeNull();
    await settle();

    expect(rows).toHaveLength(0);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('stores the delivery and sends a signed POST with the verdict', async () => {
    const { service, rows, http } = build();

    const queued = await service.notifyVerdict(job, verdict);
    await settle();

    expect(queued?.id).toBe('delivery-1');
    expect(http.post).toHaveBeenCalledTimes(1);
    const [url, body, headers, timeout] = http.post.mock.calls[0];
    expect(url).toBe('https://agent.example.org/hook');
    expect(timeout).toBe(5000);
    expect(JSON.parse(body)).toMatchObject({
      event: 'verdict.published',
      jobId: 'job-1',
      sessionId: 'session-1',
      verdictId: 'verdict-1',
      outcome: 'accept',
      signatures: ['v1', 'v2'],
      txHash: '0xtx',
    });
    expect(headers).toMatchObject({
      'content-type': 'application/json',
      'x-prom-event': 'verdict.published',
      'x-prom-delivery': 'delivery-1',
    });
    expect(verifySignature(SECRET, headers['x-prom-signature'], body)).toBe(true);
    expect(rows[0]).toMatchObject({
      status: WebhookDeliveryStatus.DELIVERED,
      attempts: 1,
      lastStatusCode: 204,
      lastError: null,
      nextAttemptAt: null,
    });
    expect(rows[0].deliveredAt).toBeInstanceOf(Date);
  });

  it('does not make the caller wait for the receiver', async () => {
    const { service, rows, http } = build();
    let answer: (value: { status: number }) => void = () => undefined;
    http.post.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

    const queued = await service.notifyVerdict(job, verdict);

    expect(queued?.status).toBe(WebhookDeliveryStatus.PENDING);
    answer({ status: 200 });
    await settle();
    expect(rows[0].status).toBe(WebhookDeliveryStatus.DELIVERED);
  });

  it('queues job.failed with the reason', async () => {
    const { service, http } = build();

    await service.notifyJobFailed(job, 'the committee did not reach a quorum');
    await settle();

    const [, body, headers] = http.post.mock.calls[0];
    expect(JSON.parse(body)).toMatchObject({
      event: WebhookEvent.JOB_FAILED,
      jobId: 'job-1',
      reason: 'the committee did not reach a quorum',
    });
    expect(headers['x-prom-event']).toBe('job.failed');
  });
});

describe('WebhooksService signing', () => {
  const OLD = 'whsec_previous';

  it('puts the delivery id and attempt into the signed request', async () => {
    const { service, http } = build();

    await service.notifyVerdict(job, verdict);
    await settle();

    const [, body, headers] = http.post.mock.calls[0];
    expect(JSON.parse(body).deliveryId).toBe('delivery-1');
    expect(headers).toMatchObject({ 'x-prom-attempt': '1', 'x-prom-delivery': 'delivery-1' });
    expect(
      verifyWebhookRequest({
        secrets: SECRET,
        signature: headers['x-prom-signature'],
        timestamp: headers['x-prom-timestamp'],
        body,
      }),
    ).toEqual({ valid: true });
  });

  it('signs with both secrets while a rotation is open and drops the old one after it', async () => {
    const { service, http, repo } = build({
      WEBHOOK_SIGNING_SECRET_PREVIOUS: OLD,
      WEBHOOK_SIGNING_SECRET_PREVIOUS_UNTIL: later(3600).toISOString(),
    });
    http.post.mockResolvedValue({ status: 500 });
    const delivery = await repo.save({
      jobId: 'job-1',
      sessionId: 'session-1',
      url: job.callbackUrl,
      event: WebhookEvent.VERDICT_PUBLISHED,
      payload: { event: 'verdict.published', jobId: 'job-1' },
      status: WebhookDeliveryStatus.PENDING,
      attempts: 0,
    } as unknown as WebhookDelivery);

    await service.attempt(delivery, NOW);
    await service.attempt(delivery, later(7200));

    const [first, second] = http.post.mock.calls.map(([, body, headers]) => ({ body, headers }));
    expect(first.headers['x-prom-signature'].match(/v1=/g)).toHaveLength(2);
    expect(verifySignature(OLD, first.headers['x-prom-signature'], first.body, NOW)).toBe(true);
    expect(verifySignature(SECRET, first.headers['x-prom-signature'], first.body, NOW)).toBe(true);

    expect(second.headers['x-prom-signature'].match(/v1=/g)).toHaveLength(1);
    expect(verifySignature(OLD, second.headers['x-prom-signature'], second.body, later(7200))).toBe(false);
    expect(second.headers['x-prom-attempt']).toBe('2');
  });

  it('refuses to start in production with the development secret', () => {
    const { service } = build({ NODE_ENV: 'production', WEBHOOK_SIGNING_SECRET: undefined });

    expect(() => service.onModuleInit()).toThrow('WEBHOOK_SIGNING_SECRET must be set');
  });

  it('starts in production with a strong secret and a rotation in progress', () => {
    const { service } = build({
      NODE_ENV: 'production',
      WEBHOOK_SIGNING_SECRET: 'n'.repeat(40),
      WEBHOOK_SIGNING_SECRET_PREVIOUS: 'o'.repeat(40),
      WEBHOOK_RETRY_POLL_MS: '0',
    });

    expect(() => service.onModuleInit()).not.toThrow();
  });
});

describe('WebhooksService retries', () => {
  const pendingDelivery = (overrides: Partial<WebhookDelivery> = {}) =>
    ({
      jobId: 'job-1',
      sessionId: 'session-1',
      url: job.callbackUrl,
      event: WebhookEvent.VERDICT_PUBLISHED,
      payload: { event: 'verdict.published', jobId: 'job-1' },
      status: WebhookDeliveryStatus.PENDING,
      attempts: 0,
      lastStatusCode: null,
      lastError: null,
      nextAttemptAt: null,
      deliveredAt: null,
      ...overrides,
    }) as WebhookDelivery;

  it('schedules a retry with backoff when the receiver answers with an error', async () => {
    const { service, http, repo } = build();
    http.post.mockResolvedValue({ status: 503 });
    const delivery = await repo.save(pendingDelivery());

    await service.attempt(delivery, NOW);
    expect(delivery).toMatchObject({
      status: WebhookDeliveryStatus.PENDING,
      attempts: 1,
      lastStatusCode: 503,
      lastError: 'receiver answered 503',
      nextAttemptAt: later(30),
    });

    await service.attempt(delivery, later(30));
    expect(delivery.nextAttemptAt).toEqual(later(30 + 60));
  });

  it('treats a redirect as a failure', async () => {
    const { service, http, repo } = build();
    http.post.mockResolvedValue({ status: 302 });
    const delivery = await repo.save(pendingDelivery());

    await service.attempt(delivery, NOW);

    expect(delivery.status).toBe(WebhookDeliveryStatus.PENDING);
    expect(delivery.lastError).toBe('receiver answered 302');
  });

  it('records network errors and timeouts', async () => {
    const { service, http, repo } = build();
    http.post.mockRejectedValue(new Error('timed out after 5000ms'));
    const delivery = await repo.save(pendingDelivery());

    await service.attempt(delivery, NOW);

    expect(delivery).toMatchObject({
      status: WebhookDeliveryStatus.PENDING,
      lastStatusCode: null,
      lastError: 'timed out after 5000ms',
    });
  });

  it('gives up after the configured number of attempts', async () => {
    const { service, http, repo } = build({ WEBHOOK_MAX_ATTEMPTS: 3 });
    http.post.mockResolvedValue({ status: 500 });
    const delivery = await repo.save(pendingDelivery());

    await service.attempt(delivery, NOW);
    await service.attempt(delivery, later(30));
    await service.attempt(delivery, later(90));

    expect(delivery).toMatchObject({
      status: WebhookDeliveryStatus.DEAD_LETTER,
      attempts: 3,
      nextAttemptAt: null,
      deadLetterReason: DeadLetterReason.EXHAUSTED,
      deadLetteredAt: later(90),
    });
  });

  it('delivers on a later attempt and clears the error', async () => {
    const { service, http, repo } = build();
    http.post.mockResolvedValueOnce({ status: 502 }).mockResolvedValueOnce({ status: 200 });
    const delivery = await repo.save(pendingDelivery());

    await service.attempt(delivery, NOW);
    await service.attempt(delivery, later(30));

    expect(delivery).toMatchObject({
      status: WebhookDeliveryStatus.DELIVERED,
      attempts: 2,
      lastError: null,
      nextAttemptAt: null,
      deliveredAt: later(30),
    });
  });

  it('never calls a refused target and does not retry it', async () => {
    const { service, http, repo } = build();
    const delivery = await repo.save(pendingDelivery({ url: 'http://169.254.169.254/latest' }));

    await service.attempt(delivery, NOW);

    expect(http.post).not.toHaveBeenCalled();
    expect(delivery.status).toBe(WebhookDeliveryStatus.DEAD_LETTER);
    expect(delivery.deadLetterReason).toBe(DeadLetterReason.TARGET_REFUSED);
    expect(delivery.lastError).toContain('target refused');
    expect(delivery.nextAttemptAt).toBeNull();
  });

  it('calls private targets only when explicitly allowed', async () => {
    const { service, http, repo } = build({ WEBHOOK_ALLOW_PRIVATE_TARGETS: 'true' });
    const delivery = await repo.save(pendingDelivery({ url: 'http://127.0.0.1:9000/hook' }));

    await service.attempt(delivery, NOW);

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(delivery.status).toBe(WebhookDeliveryStatus.DELIVERED);
  });

  it('retries the pending deliveries that are due', async () => {
    const { service, http, repo, rows } = build();
    await repo.save(pendingDelivery({ attempts: 1, nextAttemptAt: later(-5) }));
    await repo.save(pendingDelivery({ attempts: 1, nextAttemptAt: later(-1) }));
    await repo.save(pendingDelivery({ status: WebhookDeliveryStatus.DELIVERED, attempts: 1 }));

    const retried = await service.retryDue(NOW);

    expect(retried).toBe(2);
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: WebhookDeliveryStatus.PENDING }),
        take: 50,
      }),
    );
    expect(rows.slice(0, 2).every((row) => row.status === WebhookDeliveryStatus.DELIVERED)).toBe(true);
  });

  it('redelivers on request and refuses to resend a delivered webhook', async () => {
    const { service, http, repo } = build({ WEBHOOK_MAX_ATTEMPTS: 1 });
    http.post.mockResolvedValueOnce({ status: 500 }).mockResolvedValueOnce({ status: 200 });
    const delivery = await repo.save(pendingDelivery());
    await service.attempt(delivery, NOW);
    expect(delivery.status).toBe(WebhookDeliveryStatus.DEAD_LETTER);

    const redelivered = await service.redeliver(delivery.id, later(600));

    expect(redelivered).toMatchObject({ status: WebhookDeliveryStatus.DELIVERED, attempts: 2 });
    await expect(service.redeliver(delivery.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.redeliver('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists the deliveries of a job', async () => {
    const { service, repo } = build();
    await repo.save(pendingDelivery());
    await repo.save(pendingDelivery({ jobId: 'job-2' }));

    expect(await service.listForJob('job-1')).toHaveLength(1);
  });
});

describe('WebhooksService dead-letter queue', () => {
  const failing = (overrides: Partial<WebhookDelivery> = {}) =>
    ({
      jobId: 'job-1',
      sessionId: 'session-1',
      url: job.callbackUrl,
      event: WebhookEvent.VERDICT_PUBLISHED,
      payload: { event: 'verdict.published', jobId: 'job-1' },
      status: WebhookDeliveryStatus.PENDING,
      attempts: 0,
      lastStatusCode: null,
      lastError: null,
      nextAttemptAt: null,
      deliveredAt: null,
      deadLetteredAt: null,
      deadLetterReason: null,
      replayedAt: null,
      replays: 0,
      ...overrides,
    }) as WebhookDelivery;

  it.each([
    [410, DeadLetterReason.GONE],
    [400, DeadLetterReason.REJECTED],
    [422, DeadLetterReason.REJECTED],
  ])('dead-letters at once when the receiver answers %i', async (status, reason) => {
    const { service, http, repo } = build();
    http.post.mockResolvedValue({ status });
    const delivery = await repo.save(failing());

    await service.attempt(delivery, NOW);

    expect(delivery).toMatchObject({
      status: WebhookDeliveryStatus.DEAD_LETTER,
      attempts: 1,
      deadLetterReason: reason,
      lastStatusCode: status,
      lastError: `receiver answered ${status}`,
    });
  });

  it('keeps retrying 429 and auth errors, honouring Retry-After', async () => {
    const { service, http, repo } = build();
    http.post
      .mockResolvedValueOnce({ status: 429, retryAfter: '600' })
      .mockResolvedValueOnce({ status: 401 });
    const delivery = await repo.save(failing());

    await service.attempt(delivery, NOW);
    expect(delivery.status).toBe(WebhookDeliveryStatus.PENDING);
    expect(delivery.nextAttemptAt).toEqual(later(600));

    await service.attempt(delivery, later(600));
    expect(delivery.status).toBe(WebhookDeliveryStatus.PENDING);
    expect(delivery.nextAttemptAt).toEqual(later(600 + 60));
  });

  it('spreads retries with jitter but never beyond the plain backoff', async () => {
    const { service, http, repo } = build({ WEBHOOK_BACKOFF_JITTER: 0.5 });
    http.post.mockResolvedValue({ status: 503 });
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      const delivery = await repo.save(failing());
      await service.attempt(delivery, NOW);
      delays.push((delivery.nextAttemptAt as Date).getTime() - NOW.getTime());
    }

    for (const delay of delays) {
      expect(delay).toBeGreaterThan(15_000);
      expect(delay).toBeLessThanOrEqual(30_000);
    }
    expect(new Set(delays).size).toBeGreaterThan(1);
  });

  it('dead-letters a delivery that would be retried after its maximum age', async () => {
    const { service, http, repo } = build({ WEBHOOK_MAX_AGE_HOURS: 1, WEBHOOK_MAX_ATTEMPTS: 50 });
    http.post.mockResolvedValue({ status: 500 });
    const delivery = await repo.save(failing({ attempts: 7 }));

    // Attempt 8 fails 50 minutes in; the next try would be an hour later.
    await service.attempt(delivery, later(3000));

    expect(delivery).toMatchObject({
      status: WebhookDeliveryStatus.DEAD_LETTER,
      deadLetterReason: DeadLetterReason.EXPIRED,
      nextAttemptAt: null,
    });
  });

  it('lists the queue and replays it with a fresh set of attempts', async () => {
    const { service, http, repo, rows } = build({ WEBHOOK_MAX_ATTEMPTS: 1 });
    http.post.mockResolvedValue({ status: 500 });
    const first = await repo.save(failing());
    const second = await repo.save(failing({ jobId: 'job-2' }));
    await service.attempt(first, NOW);
    await service.attempt(second, NOW);
    await repo.save(failing({ url: 'http://10.0.0.1/hook' }));
    await service.attempt(rows[2], NOW);

    expect(await service.listDeadLetters()).toHaveLength(3);
    expect(await service.listDeadLetters(50, 'job-2')).toEqual([second]);

    const replayed = await service.replayDeadLetters({}, later(60));

    expect(replayed.map((d) => d.id)).toEqual([first.id, second.id]);
    expect(first).toMatchObject({
      status: WebhookDeliveryStatus.PENDING,
      attempts: 0,
      replays: 1,
      nextAttemptAt: later(60),
      replayedAt: later(60),
      deadLetteredAt: null,
      deadLetterReason: null,
    });
    // The refused target stays where it is.
    expect(rows[2].status).toBe(WebhookDeliveryStatus.DEAD_LETTER);

    http.post.mockResolvedValue({ status: 200 });
    expect(await service.retryDue(later(60))).toBe(2);
    expect(first.status).toBe(WebhookDeliveryStatus.DELIVERED);
  });

  it('replays only the requested ids that are actually dead-lettered', async () => {
    const { service, http, repo } = build({ WEBHOOK_MAX_ATTEMPTS: 1 });
    http.post.mockResolvedValue({ status: 500 });
    const dead = await repo.save(failing());
    await service.attempt(dead, NOW);
    const pending = await repo.save(failing());

    const replayed = await service.replayDeadLetters({ ids: [dead.id, pending.id, 'missing'] }, NOW);

    expect(replayed).toEqual([dead]);
  });

  it('counts the maximum age of a replayed delivery from the replay', async () => {
    const { service, http, repo } = build({ WEBHOOK_MAX_AGE_HOURS: 1 });
    http.post.mockResolvedValue({ status: 500 });
    const delivery = await repo.save(
      failing({ status: WebhookDeliveryStatus.DEAD_LETTER, deadLetterReason: DeadLetterReason.EXHAUSTED }),
    );
    await service.replayDeadLetters({ ids: [delivery.id] }, later(86_400));

    await service.attempt(delivery, later(86_400));

    expect(delivery.status).toBe(WebhookDeliveryStatus.PENDING);
    expect(delivery.nextAttemptAt).toEqual(later(86_400 + 30));
  });

  it('leaves a dead letter in the queue when a manual redelivery fails again', async () => {
    const { service, http, repo } = build({ WEBHOOK_MAX_ATTEMPTS: 1 });
    http.post.mockResolvedValue({ status: 503 });
    const delivery = await repo.save(failing());
    await service.attempt(delivery, NOW);

    await service.redeliver(delivery.id, later(600));

    expect(delivery).toMatchObject({
      status: WebhookDeliveryStatus.DEAD_LETTER,
      attempts: 2,
      deadLetteredAt: later(600),
      nextAttemptAt: null,
    });
  });
});

describe('WebhooksService retry timer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('polls for due deliveries until shutdown and can be switched off', async () => {
    const on = build();
    on.service.onModuleInit();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(on.repo.find).toHaveBeenCalledTimes(1);
    on.service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(on.repo.find).toHaveBeenCalledTimes(1);

    const off = build({ WEBHOOK_RETRY_POLL_MS: '0' });
    off.service.onModuleInit();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(off.repo.find).not.toHaveBeenCalled();
  });
});
