import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DisputeStatus } from '../src/modules/disputes/entities/dispute.entity';
import { CsrfSession, csrfSession, mutate } from './helpers/csrf';

/**
 * Dispute lifecycle end to end: open, inspect, resolve.
 *
 * Escalation is the path that matters for money — an unresolved dispute holds
 * an escrow open on the payment rail — so the failure modes are covered as
 * carefully as the happy path.
 */
describe('Dispute escalation (e2e)', () => {
  let app: INestApplication;
  let csrf: CsrfSession;

  const openDispute = (overrides: Record<string, unknown> = {}) =>
    mutate(app, csrf, 'post', '/disputes')
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
    csrf = await csrfSession(app);
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

    const resolved = await mutate(app, csrf, 'patch', `/disputes/${opened.body.id}/resolve`)
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

    await mutate(app, csrf, 'patch', `/disputes/${opened.body.id}/resolve`)
      .send({ resolution: 'first' })
      .expect(200);

    const second = await mutate(app, csrf, 'patch', `/disputes/${opened.body.id}/resolve`)
      .send({ resolution: 'second' });

    expect([400, 409]).toContain(second.status);
  });

  it('returns 404 for an unknown dispute', async () => {
    await request(app.getHttpServer())
      .get('/disputes/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });

  it('returns 404 when resolving an unknown dispute', async () => {
    await mutate(app, csrf, 'patch', '/disputes/00000000-0000-0000-0000-000000000000/resolve')
      .send({ resolution: 'nothing to resolve' })
      .expect(404);
  });

  it.each([
    [{ sessionId: '' }, 'empty session id'],
    [{ reason: '' }, 'empty reason'],
    [{ initiator: 'not-a-did' }, 'initiator is not a DID'],
  ])('rejects an invalid dispute payload (%s)', async (overrides: Record<string, unknown>, _label: string) => {
    const res = await openDispute(overrides);
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields rather than silently dropping them', async () => {
    const res = await openDispute({ escalateImmediately: true });
    expect(res.status).toBe(400);
  });

  describe('evidence', () => {
    const sha256 = (content: Buffer) => `0x${createHash('sha256').update(content).digest('hex')}`;
    const attach = (disputeId: string, body: Record<string, unknown>) =>
      mutate(app, csrf, 'post', `/disputes/${disputeId}/evidence`).send({
        submitter: 'did:prom:agent-a',
        uri: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        ...body,
      });

    it('hashes inline content and stores the evidence as verified', async () => {
      const opened = await openDispute().expect(201);
      const content = Buffer.from('delivery log: 3 of 5 files missing');

      const res = await attach(opened.body.id, {
        content: content.toString('base64'),
        mimeType: 'text/plain',
        description: 'delivery log',
      }).expect(201);

      expect(res.body).toMatchObject({
        disputeId: opened.body.id,
        contentHash: sha256(content),
        sizeBytes: content.length,
        hashVerified: true,
        mimeType: 'text/plain',
      });
      expect(res.body.content).toBeUndefined();
    });

    it('stores a declared hash as a claim and verifies it later', async () => {
      const opened = await openDispute().expect(201);
      const content = Buffer.from(`screenshot-bytes-${randomUUID()}`);

      const attached = await attach(opened.body.id, {
        uri: 'https://evidence.example.org/screenshot.png',
        contentHash: sha256(content).toUpperCase().replace('0X', '0x'),
        sizeBytes: content.length,
      }).expect(201);
      expect(attached.body.hashVerified).toBe(false);
      expect(attached.body.contentHash).toBe(sha256(content));

      const wrong = await mutate(
        app,
        csrf,
        'post',
        `/disputes/${opened.body.id}/evidence/${attached.body.id}/verify`,
      )
        .send({ content: Buffer.from('something else').toString('base64') })
        .expect(200);
      expect(wrong.body.matches).toBe(false);

      const right = await mutate(
        app,
        csrf,
        'post',
        `/disputes/${opened.body.id}/evidence/${attached.body.id}/verify`,
      )
        .send({ content: content.toString('base64') })
        .expect(200);
      expect(right.body).toMatchObject({ matches: true, computedHash: sha256(content) });

      const listed = await request(app.getHttpServer())
        .get(`/disputes/${opened.body.id}/evidence`)
        .expect(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0].hashVerified).toBe(true);
    });

    it('rejects content that does not match the declared hash', async () => {
      const opened = await openDispute().expect(201);

      await attach(opened.body.id, {
        content: Buffer.from('actual').toString('base64'),
        contentHash: sha256(Buffer.from('claimed')),
      }).expect(400);
    });

    it('rejects evidence without a hash, with a bad URI or with broken base64', async () => {
      const opened = await openDispute().expect(201);
      const hash = sha256(Buffer.from('x'));

      await attach(opened.body.id, {}).expect(400);
      await attach(opened.body.id, { contentHash: '0x1234' }).expect(400);
      await attach(opened.body.id, { contentHash: hash, uri: 'file:///etc/passwd' }).expect(400);
      await attach(opened.body.id, { contentHash: hash, submitter: 'anonymous' }).expect(400);
      await attach(opened.body.id, { content: 'not base64!!' }).expect(400);
    });

    it('rejects the same content twice on one dispute but not across disputes', async () => {
      const first = await openDispute().expect(201);
      const second = await openDispute().expect(201);
      const contentHash = sha256(Buffer.from(`shared-${randomUUID()}`));

      await attach(first.body.id, { contentHash }).expect(201);
      await attach(first.body.id, { contentHash }).expect(409);
      await attach(second.body.id, { contentHash }).expect(201);
    });

    it('accepts no more evidence once the dispute is resolved', async () => {
      const opened = await openDispute().expect(201);
      await mutate(app, csrf, 'patch', `/disputes/${opened.body.id}/resolve`)
        .send({ resolution: 'closed' })
        .expect(200);

      await attach(opened.body.id, { contentHash: sha256(Buffer.from('late')) }).expect(409);
    });

    it('returns 404 for evidence on an unknown dispute', async () => {
      const unknown = randomUUID();

      await attach(unknown, { contentHash: sha256(Buffer.from('x')) }).expect(404);
      await request(app.getHttpServer()).get(`/disputes/${unknown}/evidence`).expect(404);
      await request(app.getHttpServer()).get('/disputes/not-a-uuid/evidence').expect(400);
    });
  });
});
