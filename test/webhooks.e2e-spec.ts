import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import { createServer, IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { verifySignature } from '../src/modules/webhooks/webhook-signature';
import { CsrfSession, csrfSession, mutate } from './helpers/csrf';

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

const SECRET = 'whsec_e2e';

/**
 * Verdict webhooks end to end: the service calls a real HTTP receiver started
 * by this suite on the loopback interface, which is why private targets are
 * allowed for this suite only.
 */
describe('Verdict webhooks (e2e)', () => {
  let app: INestApplication;
  let csrf: CsrfSession;
  let receiver: Server;
  let receiverUrl: string;
  const received: Received[] = [];
  /** Status the receiver answers with, per path. */
  const answers = new Map<string, number>();
  const savedEnv = {
    allow: process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS,
    secret: process.env.WEBHOOK_SIGNING_SECRET,
  };

  const submit = (body: Record<string, unknown>) => {
    const sessionId = randomUUID();
    return mutate(app, csrf, 'post', '/jobs').send({
      sessionId,
      requestHash: ethers.id(`request-${sessionId}`),
      policyId: randomUUID(),
      ...body,
    });
  };

  const deliveries = async (jobId: string) =>
    (await request(app.getHttpServer()).get(`/jobs/${jobId}/webhooks`).expect(200)).body as Array<{
      id: string;
      status: string;
      attempts: number;
      event: string;
      lastStatusCode: number | null;
      lastError: string | null;
      nextAttemptAt: string | null;
    }>;

  /** The first attempt runs in the background; wait until it has been recorded. */
  const waitForAttempt = async (jobId: string) => {
    for (let i = 0; i < 300; i++) {
      const [delivery] = await deliveries(jobId);
      if (delivery && (delivery.status !== 'pending' || delivery.nextAttemptAt !== null)) {
        return delivery;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`no webhook attempt recorded for job ${jobId}`);
  };

  beforeAll(async () => {
    receiver = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const path = req.url ?? '/';
        received.push({ path, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        res.statusCode = answers.get(path) ?? 204;
        res.end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;

    process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = 'true';
    process.env.WEBHOOK_SIGNING_SECRET = SECRET;
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
    if (savedEnv.allow === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
    else process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = savedEnv.allow;
    if (savedEnv.secret === undefined) delete process.env.WEBHOOK_SIGNING_SECRET;
    else process.env.WEBHOOK_SIGNING_SECRET = savedEnv.secret;
    await app?.close();
    await new Promise((resolve) => receiver.close(resolve));
  });

  it('posts a signed verdict to the callback URL of the job', async () => {
    const path = `/hooks/${randomUUID()}`;
    const res = await submit({ callbackUrl: `${receiverUrl}${path}` }).expect(201);
    const jobId: string = res.body.job.id;
    expect(res.body.job.callbackUrl).toBe(`${receiverUrl}${path}`);

    const delivery = await waitForAttempt(jobId);
    expect(delivery).toMatchObject({
      status: 'delivered',
      attempts: 1,
      event: 'verdict.published',
      lastStatusCode: 204,
      lastError: null,
    });

    const call = received.find((r) => r.path === path) as Received;
    expect(call).toBeDefined();
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.headers['x-prom-event']).toBe('verdict.published');
    expect(call.headers['x-prom-delivery']).toBe(delivery.id);
    expect(verifySignature(SECRET, call.headers['x-prom-signature'] as string, call.body)).toBe(true);
    expect(verifySignature('some-other-secret', call.headers['x-prom-signature'] as string, call.body)).toBe(false);

    const verdict = await request(app.getHttpServer())
      .get(`/verdicts/${res.body.job.sessionId}`)
      .expect(200);
    expect(JSON.parse(call.body)).toMatchObject({
      event: 'verdict.published',
      jobId,
      sessionId: res.body.job.sessionId,
      verdictId: verdict.body.id,
      outcome: 'accept',
      signatures: verdict.body.signatures,
    });
  });

  it('sends nothing for a job without a callback URL', async () => {
    const before = received.length;
    const res = await submit({}).expect(201);

    expect(res.body.job.callbackUrl).toBeNull();
    expect(await deliveries(res.body.job.id)).toEqual([]);
    expect(received.length).toBe(before);
  });

  it('notifies when a queued job is processed later', async () => {
    const path = `/hooks/${randomUUID()}`;
    const res = await submit({ callbackUrl: `${receiverUrl}${path}`, deferred: true }).expect(201);
    expect(await deliveries(res.body.job.id)).toEqual([]);

    await mutate(app, csrf, 'post', '/jobs/queue/drain').send({ limit: 100 }).expect(200);

    expect((await waitForAttempt(res.body.job.id)).status).toBe('delivered');
    expect(received.filter((r) => r.path === path)).toHaveLength(1);
  });

  it('keeps a failed delivery for retry and delivers it on request', async () => {
    const path = `/hooks/${randomUUID()}`;
    answers.set(path, 503);
    const res = await submit({ callbackUrl: `${receiverUrl}${path}` }).expect(201);
    // The verdict itself is not affected by the receiver being down.
    expect(res.body.verification.outcome).toBe('accept');

    const failed = await waitForAttempt(res.body.job.id);
    expect(failed).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastStatusCode: 503,
      lastError: 'receiver answered 503',
    });
    expect(new Date(failed.nextAttemptAt as string).getTime()).toBeGreaterThan(Date.now());

    answers.set(path, 200);
    const redelivered = await mutate(
      app,
      csrf,
      'post',
      `/webhooks/deliveries/${failed.id}/redeliver`,
    ).expect(200);
    expect(redelivered.body).toMatchObject({ status: 'delivered', attempts: 2, lastStatusCode: 200 });
    expect(received.filter((r) => r.path === path)).toHaveLength(2);

    await mutate(app, csrf, 'post', `/webhooks/deliveries/${failed.id}/redeliver`).expect(409);
    await mutate(app, csrf, 'post', `/webhooks/deliveries/${randomUUID()}/redeliver`).expect(404);
  });

  it('records an unreachable receiver without failing the job', async () => {
    // Nothing listens on port 9 (discard) of the loopback interface.
    const res = await submit({ callbackUrl: 'http://127.0.0.1:9/hook' }).expect(201);
    expect(res.body.verification.outcome).toBe('accept');

    const failed = await waitForAttempt(res.body.job.id);
    expect(failed.status).toBe('pending');
    expect(failed.lastStatusCode).toBeNull();
    expect(failed.lastError).toBeTruthy();
  }, 30_000);

  it('rejects callback URLs that are not http(s)', async () => {
    await submit({ callbackUrl: 'ftp://example.org/hook' }).expect(400);
    await submit({ callbackUrl: 'not a url' }).expect(400);
    await submit({ callbackUrl: 'https://user:secret@example.org/hook' }).expect(400);
  });
});
