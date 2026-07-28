import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DisputeStatus } from '../src/modules/disputes/entities/dispute.entity';

/**
 * Dispute lifecycle end to end: open, inspect, resolve.
 *
 * Escalation is the path that matters for money — an unresolved dispute holds
 * an escrow open on the payment rail — so the failure modes are covered as
 * carefully as the happy path.
 */
describe('Dispute escalation (e2e)', () => {
  let app: INestApplication;

  const openDispute = (overrides: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/disputes')
      .send({
        sessionId: `dispute-session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        reason: 'verdict does not match the delivered work',
        initiator: 'did:prom:agent-a',
        ...overrides,
      });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('opens a dispute in the open state', async () => {
    const res = await openDispute().expect(201);

    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe(DisputeStatus.OPEN);
    expect(res.body.resolvedAt).toBeNull();
  });

  it('reads back an opened dispute', async () => {
    const opened = await openDispute().expect(201);
    const res = await request(app.getHttpServer())
      .get(`/disputes/${opened.body.id}`)
      .expect(200);

    expect(res.body.id).toBe(opened.body.id);
    expect(res.body.reason).toBe('verdict does not match the delivered work');
  });

  it('resolves an open dispute and records the outcome', async () => {
    const opened = await openDispute().expect(201);

    const resolved = await request(app.getHttpServer())
      .patch(`/disputes/${opened.body.id}/resolve`)
      .send({ resolution: 'verdict upheld after re-verification' })
      .expect(200);

    expect(resolved.body.status).toBe(DisputeStatus.RESOLVED);
    expect(resolved.body.resolution).toBe('verdict upheld after re-verification');
    expect(resolved.body.resolvedAt).not.toBeNull();
  });

  it('refuses to resolve the same dispute twice', async () => {
    // Double resolution would overwrite the recorded outcome, and the escrow
    // released on the first resolution cannot be released again.
    const opened = await openDispute().expect(201);

    await request(app.getHttpServer())
      .patch(`/disputes/${opened.body.id}/resolve`)
      .send({ resolution: 'first' })
      .expect(200);

    const second = await request(app.getHttpServer())
      .patch(`/disputes/${opened.body.id}/resolve`)
      .send({ resolution: 'second' });

    expect([400, 409]).toContain(second.status);
  });

  it('returns 404 for an unknown dispute', async () => {
    await request(app.getHttpServer())
      .get('/disputes/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });

  it('returns 404 when resolving an unknown dispute', async () => {
    await request(app.getHttpServer())
      .patch('/disputes/00000000-0000-0000-0000-000000000000/resolve')
      .send({ resolution: 'nothing to resolve' })
      .expect(404);
  });

  it.each([
    [{ sessionId: '' }, 'empty session id'],
    [{ reason: '' }, 'empty reason'],
    [{ initiator: 'not-a-did' }, 'initiator is not a DID'],
  ])('rejects an invalid dispute payload (%s)', async (overrides) => {
    const res = await openDispute(overrides);
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields rather than silently dropping them', async () => {
    const res = await openDispute({ escalateImmediately: true });
    expect(res.status).toBe(400);
  });
});
