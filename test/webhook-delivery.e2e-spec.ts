import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { verifyWebhookRequest } from '../src/modules/webhooks/webhook-signature';
import { CsrfSession, csrfSession, mutate } from './helpers/csrf';
import { WebhookReceiver, eventually } from './helpers/webhook-receiver';

const CURRENT = 'whsec_e2e_current_0123456789abcdef';
const PREVIOUS = 'whsec_e2e_previous_0123456789abcdef';

interface DeliveryView {
  id: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  nextAttemptAt: string | null;
  deadLetterReason: string | null;
  deadLetteredAt: string | null;
  replays: number;
  updatedAt?: string;
}

/**
 * Signing and retry behaviour of verdict webhooks against a real receiver,
 * with the retry poller running fast enough to watch whole retry sequences:
 * 150 ms base backoff without jitter, three attempts, a secret rotation open.
 */
describe('Verdict webhook signing and retries (e2e)', () => {
  let app: INestApplication;
  let csrf: CsrfSession;
  const receiver = new WebhookReceiver();
  const settings: Record<string, string> = {
    WEBHOOK_ALLOW_PRIVATE_TARGETS: 'true',
    WEBHOOK_SIGNING_SECRET: CURRENT,
    WEBHOOK_SIGNING_SECRET_PREVIOUS: PREVIOUS,
    WEBHOOK_SIGNING_SECRET_PREVIOUS_UNTIL: new Date(Date.now() + 3_600_000).toISOString(),
    WEBHOOK_RETRY_POLL_MS: '100',
    WEBHOOK_BACKOFF_BASE_MS: '150',
    WEBHOOK_BACKOFF_JITTER: '0',
    WEBHOOK_MAX_ATTEMPTS: '3',
  };
  const saved: Record<string, string | undefined> = {};

  const submit = (path: string) => {
    const sessionId = randomUUID();
    return mutate(app, csrf, 'post', '/jobs')
      .send({
        sessionId,
        requestHash: ethers.id(`request-${sessionId}`),
        policyId: randomUUID(),
        callbackUrl: `${receiver.url}${path}`,
      })
      .expect(201);
  };

  const deliveryOf = async (jobId: string): Promise<DeliveryView | undefined> => {
    const res = await request(app.getHttpServer()).get(`/jobs/${jobId}/webhooks`).expect(200);
    return (res.body as DeliveryView[])[0];
  };

  const waitFor = (jobId: string, done: (d: DeliveryView) => boolean, what: string) =>
    eventually(async () => {
      const delivery = await deliveryOf(jobId);
      return delivery && done(delivery) ? delivery : undefined;
    }, what);

  beforeAll(async () => {
    await receiver.start();
    for (const [key, value] of Object.entries(settings)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    csrf = await csrfSession(app);
  });

  afterAll(async () => {
    await app?.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await receiver.stop();
  });

  it('retries until delivered and signs every attempt anew for both secrets', async () => {
    const path = `/hooks/${randomUUID()}`;
    receiver.answer(path, 503, 502, 200);

    const res = await submit(path);
    const delivery = await waitFor(res.body.job.id, (d) => d.status === 'delivered', 'delivery');

    expect(delivery).toMatchObject({ attempts: 3, lastStatusCode: 200, deadLetterReason: null });
    const calls = receiver.on(path);
    expect(calls.map((call) => call.headers['x-prom-attempt'])).toEqual(['1', '2', '3']);
    for (const call of calls) {
      expect(call.headers['x-prom-delivery']).toBe(delivery.id);
      expect(JSON.parse(call.body)).toMatchObject({ deliveryId: delivery.id, jobId: res.body.job.id });
      for (const secret of [CURRENT, PREVIOUS]) {
        expect(
          verifyWebhookRequest({
            secrets: secret,
            signature: call.headers['x-prom-signature'] as string,
            timestamp: call.headers['x-prom-timestamp'] as string,
            body: call.body,
          }),
        ).toEqual({ valid: true });
      }
      expect(
        verifyWebhookRequest({
          secrets: 'whsec_somebody_else',
          signature: call.headers['x-prom-signature'] as string,
          body: call.body,
        }),
      ).toEqual({ valid: false, reason: 'signature_mismatch' });
    }
  });

  it('moves a delivery to the dead-letter queue when the attempts run out', async () => {
    const path = `/hooks/${randomUUID()}`;
    receiver.answer(path, 500);

    const res = await submit(path);
    const dead = await waitFor(res.body.job.id, (d) => d.status === 'dead_letter', 'dead letter');

    expect(dead).toMatchObject({ attempts: 3, deadLetterReason: 'exhausted', nextAttemptAt: null });
    expect(receiver.on(path)).toHaveLength(3);
    // Nothing is sent any more once the delivery is dead-lettered.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(receiver.on(path)).toHaveLength(3);
  });

  it('dead-letters a gone endpoint at once and replays it once it is back', async () => {
    const path = `/hooks/${randomUUID()}`;
    receiver.answer(path, 410);
    const res = await submit(path);
    const jobId: string = res.body.job.id;

    const dead = await waitFor(jobId, (d) => d.status === 'dead_letter', 'dead letter');
    expect(dead).toMatchObject({ attempts: 1, deadLetterReason: 'gone', lastStatusCode: 410 });

    const queue = await request(app.getHttpServer())
      .get('/webhooks/dead-letters')
      .query({ jobId })
      .expect(200);
    expect(queue.body.map((d: DeliveryView) => d.id)).toEqual([dead.id]);

    receiver.answer(path, 204);
    const replay = await mutate(app, csrf, 'post', '/webhooks/dead-letters/replay')
      .send({ ids: [dead.id] })
      .expect(200);
    expect(replay.body).toMatchObject({ replayed: 1 });
    expect(replay.body.deliveries[0]).toMatchObject({ id: dead.id, status: 'pending', attempts: 0 });

    const delivered = await waitFor(jobId, (d) => d.status === 'delivered', 'replayed delivery');
    expect(delivered).toMatchObject({ attempts: 1, replays: 1, deadLetterReason: null });
    expect(receiver.on(path)).toHaveLength(2);
    expect(
      (await request(app.getHttpServer()).get('/webhooks/dead-letters').query({ jobId }).expect(200)).body,
    ).toEqual([]);
  });

  it('waits as long as Retry-After asks', async () => {
    const path = `/hooks/${randomUUID()}`;
    receiver.answer(path, { status: 503, headers: { 'retry-after': '1800' } });
    const before = Date.now();

    const res = await submit(path);
    const waiting = await waitFor(res.body.job.id, (d) => d.nextAttemptAt !== null, 'first attempt');

    expect(waiting.status).toBe('pending');
    expect(new Date(waiting.nextAttemptAt as string).getTime() - before).toBeGreaterThanOrEqual(
      1_790_000,
    );
    // Parked for half an hour: the fast poller does not touch it again.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(receiver.on(path)).toHaveLength(1);
  });

  it('validates dead-letter queries and replay requests', async () => {
    await request(app.getHttpServer()).get('/webhooks/dead-letters').query({ limit: 500 }).expect(400);
    await request(app.getHttpServer()).get('/webhooks/dead-letters').query({ jobId: 'job-1' }).expect(400);
    await mutate(app, csrf, 'post', '/webhooks/dead-letters/replay').send({ ids: ['nope'] }).expect(400);
    await mutate(app, csrf, 'post', '/webhooks/dead-letters/replay').send({ limit: 0 }).expect(400);

    const nothing = await mutate(app, csrf, 'post', '/webhooks/dead-letters/replay')
      .send({ ids: [randomUUID()] })
      .expect(200);
    expect(nothing.body).toEqual({ replayed: 0, deliveries: [] });
  });
});
