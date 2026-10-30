import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CsrfSession, csrfSession, mutate } from './helpers/csrf';

/**
 * Overturned verdict to slashed stake, end to end: a job is verified by a
 * staked committee, the verdict is disputed and overturned, and the proposals
 * raised for its signers are approved or rejected by an operator.
 */
describe('Slashing proposals (e2e)', () => {
  let app: INestApplication;
  let csrf: CsrfSession;

  const ETHER = 10n ** 18n;
  const operator = { decidedBy: 'did:prom:operator-1' };

  const disputedVerdict = async (outcome?: string) => {
    const sessionId = randomUUID();
    const job = await mutate(app, csrf, 'post', '/jobs')
      .send({
        sessionId,
        requestHash: ethers.id(`request-${sessionId}`),
        policyId: randomUUID(),
      })
      .expect(201);
    const verdict = await request(app.getHttpServer()).get(`/verdicts/${sessionId}`).expect(200);

    const dispute = await mutate(app, csrf, 'post', '/disputes')
      .send({ sessionId, reason: 'result does not match the request', initiator: 'did:prom:agent-a' })
      .expect(201);
    const resolved = await mutate(app, csrf, 'patch', `/disputes/${dispute.body.id}/resolve`)
      .send({ resolution: 'independent re-verification disagrees', ...(outcome ? { outcome } : {}) })
      .expect(200);

    return {
      sessionId,
      jobId: job.body.job.id as string,
      signers: verdict.body.signatures as string[],
      verdictId: verdict.body.id as string,
      dispute: resolved.body,
    };
  };

  const proposalsFor = async (disputeId: string) =>
    (await request(app.getHttpServer()).get('/slashing/proposals').query({ disputeId }).expect(200))
      .body as Array<{ id: string; validatorId: string; amount: string; status: string }>;

  const validator = async (id: string) =>
    (await request(app.getHttpServer()).get(`/validators/${id}`).expect(200)).body;

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

    // Enough staked validators for a full committee whatever else is in the
    // database; the tests work with whichever three get drawn.
    for (let i = 0; i < 3; i++) {
      const wallet = ethers.Wallet.createRandom();
      await mutate(app, csrf, 'post', '/validators')
        .send({
          address: wallet.address,
          publicKey: wallet.signingKey.compressedPublicKey,
          stake: (10n * ETHER).toString(),
          endpoint: `http://slashable-${i}:9090`,
        })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('raises a proposal for every signer of an overturned verdict', async () => {
    const { signers, dispute, verdictId, sessionId } = await disputedVerdict('overturned');
    expect(dispute.outcome).toBe('overturned');
    expect(signers).toHaveLength(3);

    const proposals = await proposalsFor(dispute.id);

    expect(proposals.map((p) => p.validatorId).sort()).toEqual([...signers].sort());
    for (const proposal of proposals) {
      const { stake } = await validator(proposal.validatorId);
      expect(proposal).toMatchObject({
        status: 'proposed',
        verdictId,
        sessionId,
        stakeAtProposal: stake,
        amount: (BigInt(stake) / 10n).toString(),
      });
    }
  });

  it('records the lost dispute in the reputation of the signers', async () => {
    const { signers } = await disputedVerdict('overturned');

    for (const validatorId of signers) {
      const res = await request(app.getHttpServer()).get(`/reputation/${validatorId}`).expect(200);

      expect(res.body.entityType).toBe('validator');
      expect(Number(res.body.disputeLossRate)).toBeGreaterThan(0);
      expect(Number(res.body.accuracy)).toBeLessThan(1);
      expect(res.body.totalJobs).toBeGreaterThanOrEqual(1);
      // Seen a moment ago: nothing has decayed yet.
      expect(res.body.decayFactor).toBeCloseTo(1, 3);
      expect(res.body.effectiveScore).toBeCloseTo(res.body.rawScore, 3);
      expect(res.body.halfLifeDays).toBe(30);
    }
  });

  it('raises nothing when the verdict is upheld or the outcome is not stated', async () => {
    const upheld = await disputedVerdict('upheld');
    const unstated = await disputedVerdict();

    expect(upheld.dispute.outcome).toBe('upheld');
    expect(unstated.dispute.outcome).toBeNull();
    expect(await proposalsFor(upheld.dispute.id)).toEqual([]);
    expect(await proposalsFor(unstated.dispute.id)).toEqual([]);
  });

  it('reduces the stake on approval and leaves it alone on rejection', async () => {
    const { dispute } = await disputedVerdict('overturned');
    const [toApprove, toReject] = await proposalsFor(dispute.id);
    const before = await validator(toApprove.validatorId);
    const untouched = await validator(toReject.validatorId);

    const approved = await mutate(app, csrf, 'patch', `/slashing/proposals/${toApprove.id}/approve`)
      .send({ ...operator, note: 'confirmed' })
      .expect(200);
    expect(approved.body).toMatchObject({
      status: 'approved',
      decidedBy: operator.decidedBy,
      decisionNote: 'confirmed',
    });

    const after = await validator(toApprove.validatorId);
    expect(BigInt(after.stake)).toBe(BigInt(before.stake) - BigInt(toApprove.amount));

    const rejected = await mutate(app, csrf, 'patch', `/slashing/proposals/${toReject.id}/reject`)
      .send(operator)
      .expect(200);
    expect(rejected.body.status).toBe('rejected');
    expect((await validator(toReject.validatorId)).stake).toBe(untouched.stake);

    // A decision is final.
    await mutate(app, csrf, 'patch', `/slashing/proposals/${toApprove.id}/approve`)
      .send(operator)
      .expect(409);
    await mutate(app, csrf, 'patch', `/slashing/proposals/${toReject.id}/approve`)
      .send(operator)
      .expect(409);
    expect((await validator(toApprove.validatorId)).stake).toBe(after.stake);

    const listed = await request(app.getHttpServer())
      .get('/slashing/proposals')
      .query({ disputeId: dispute.id, status: 'proposed' })
      .expect(200);
    expect(listed.body).toHaveLength(1);
  });

  it('validates ids, filters and decision payloads', async () => {
    await request(app.getHttpServer()).get('/slashing/proposals/not-a-uuid').expect(400);
    await request(app.getHttpServer()).get(`/slashing/proposals/${randomUUID()}`).expect(404);
    await request(app.getHttpServer()).get('/slashing/proposals').query({ status: 'burned' }).expect(400);
    await mutate(app, csrf, 'patch', `/slashing/proposals/${randomUUID()}/approve`)
      .send({})
      .expect(400);

    const dispute = await mutate(app, csrf, 'post', '/disputes')
      .send({ sessionId: randomUUID(), reason: 'no verdict yet', initiator: 'did:prom:agent-a' })
      .expect(201);
    await mutate(app, csrf, 'patch', `/disputes/${dispute.body.id}/resolve`)
      .send({ resolution: 'x', outcome: 'annulled' })
      .expect(400);
    // Overturning a session that never got a verdict has nobody to slash.
    await mutate(app, csrf, 'patch', `/disputes/${dispute.body.id}/resolve`)
      .send({ resolution: 'nothing was verified', outcome: 'overturned' })
      .expect(200);
    expect(await proposalsFor(dispute.body.id)).toEqual([]);
  });
});
