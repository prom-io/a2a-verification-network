import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CsrfSession, csrfSession, mutate } from './helpers/csrf';

/**
 * Deferred jobs wait in a fee-weighted queue and are processed from its head.
 * The ordering under test is the one the database computes, so this runs
 * against PostgreSQL rather than a stubbed repository.
 */
describe('Job priority queue (e2e)', () => {
  let app: INestApplication;
  let csrf: CsrfSession;

  const FEE_UNIT = 10n ** 15n;

  const submit = (body: Record<string, unknown> = {}) => {
    const sessionId = randomUUID();
    return mutate(app, csrf, 'post', '/jobs').send({
      sessionId,
      requestHash: ethers.id(`request-${sessionId}`),
      policyId: randomUUID(),
      ...body,
    });
  };

  const defer = async (feeUnits: number) => {
    const res = await submit({ deferred: true, fee: (BigInt(feeUnits) * FEE_UNIT).toString() }).expect(201);
    return res.body.job as { id: string; sessionId: string };
  };

  /** Queue restricted to the given jobs, so leftovers of other runs do not matter. */
  const queueOf = async (ids: string[]) => {
    const res = await request(app.getHttpServer()).get('/jobs/queue').query({ limit: 200 }).expect(200);
    return (res.body as Array<{ position: number; score: number; job: { id: string } }>).filter(
      (entry) => ids.includes(entry.job.id),
    );
  };

  const drainAll = async () => {
    for (let i = 0; i < 20; i++) {
      const res = await mutate(app, csrf, 'post', '/jobs/queue/drain').send({ limit: 100 }).expect(200);
      if (res.body.length === 0) return;
    }
    throw new Error('queue did not drain');
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    csrf = await csrfSession(app);
    await drainAll();
  });

  afterAll(async () => {
    await drainAll();
    await app?.close();
  });

  it('leaves a deferred job pending and unverified', async () => {
    const res = await submit({ deferred: true, fee: FEE_UNIT.toString() }).expect(201);

    expect(res.body.queued).toBe(true);
    expect(res.body.verification).toBeNull();
    expect(res.body.job).toMatchObject({ status: 'pending', fee: FEE_UNIT.toString() });
    await request(app.getHttpServer()).get(`/verdicts/${res.body.job.sessionId}`).expect(404);
    await drainAll();
  });

  it('still processes a job in the request by default', async () => {
    const res = await submit({ fee: '0' }).expect(201);

    expect(res.body.queued).toBe(false);
    expect(res.body.verification.outcome).toBe('accept');
    expect(await queueOf([res.body.job.id])).toEqual([]);
  });

  it('orders the queue by fee, highest first', async () => {
    const free = await defer(0);
    const premium = await defer(50);
    const standard = await defer(5);

    const queue = await queueOf([free.id, premium.id, standard.id]);

    expect(queue.map((entry) => entry.job.id)).toEqual([premium.id, standard.id, free.id]);
    expect(queue[0].position).toBeLessThan(queue[1].position);
    expect(queue[0].score).toBeGreaterThanOrEqual(50);
    expect(queue[2].score).toBeLessThan(1);
    await drainAll();
  });

  it('drains from the head and leaves the rest queued', async () => {
    const free = await defer(0);
    const premium = await defer(50);
    const standard = await defer(5);

    const first = await mutate(app, csrf, 'post', '/jobs/queue/drain').send({ limit: 1 }).expect(200);
    expect(first.body).toEqual([
      { jobId: premium.id, outcome: 'accept', verdictId: expect.any(String) },
    ]);
    expect((await queueOf([free.id, premium.id, standard.id])).map((e) => e.job.id)).toEqual([
      standard.id,
      free.id,
    ]);
    const verdict = await request(app.getHttpServer()).get(`/verdicts/${premium.sessionId}`).expect(200);
    expect(verdict.body.jobId).toBe(premium.id);
    const done = await request(app.getHttpServer()).get(`/jobs/${premium.id}`).expect(200);
    expect(done.body.status).toBe('completed');

    const rest = await mutate(app, csrf, 'post', '/jobs/queue/drain').send({}).expect(200);
    expect(rest.body.map((r: { jobId: string }) => r.jobId)).toEqual([standard.id, free.id]);
    expect(await queueOf([free.id, standard.id])).toEqual([]);
    await request(app.getHttpServer()).get(`/verdicts/${free.sessionId}`).expect(200);
  });

  it('honours the listing limit', async () => {
    const jobs = [await defer(1), await defer(2), await defer(3)];

    const res = await request(app.getHttpServer()).get('/jobs/queue').query({ limit: 2 }).expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0].job.id).toBe(jobs[2].id);
    expect(res.body[1].job.id).toBe(jobs[1].id);
    await drainAll();
  });

  it('validates fees, flags and limits', async () => {
    await submit({ fee: '-1' }).expect(400);
    await submit({ fee: '1.5' }).expect(400);
    await submit({ fee: 12 }).expect(400);
    await submit({ deferred: 'yes' }).expect(400);
    await mutate(app, csrf, 'post', '/jobs/queue/drain').send({ limit: 0 }).expect(400);
    await mutate(app, csrf, 'post', '/jobs/queue/drain').send({ limit: 1000 }).expect(400);
    await request(app.getHttpServer()).get('/jobs/queue').query({ limit: 'many' }).expect(400);
    await request(app.getHttpServer()).get('/jobs/queue').query({ limit: 500 }).expect(400);
  });
});
