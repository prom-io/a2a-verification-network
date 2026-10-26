import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { computeCommitHash } from '../src/modules/commit-reveal/commitment';
import { VerdictOutcome } from '../src/modules/verdicts/entities/verdict.entity';
import { CsrfSession, csrfSession, mutate } from './helpers/csrf';

interface Member {
  id: string;
  wallet: ethers.HDNodeWallet;
  salt: string;
}

/**
 * Commit-reveal verdicts end to end, against the real schema: a committee of
 * three staked validators commits signed hashes, reveals, and the service
 * publishes the majority verdict.
 */
describe('Commit-reveal verdicts (e2e)', () => {
  let app: INestApplication;
  let csrf: CsrfSession;
  let committee: Member[];

  const ETHER = 10n ** 18n;

  const submitJob = (verdictMode?: string) =>
    mutate(app, csrf, 'post', '/jobs').send({
      sessionId: randomUUID(),
      requestHash: ethers.id(`request-${randomUUID()}`),
      policyId: randomUUID(),
      ...(verdictMode ? { verdictMode } : {}),
    });

  // Signing is asynchronous, so the expected status is passed in instead of
  // being chained on the returned request.
  const commit = async (
    jobId: string,
    member: Member,
    outcome: VerdictOutcome,
    expectedStatus: number,
  ) => {
    const commitHash = computeCommitHash(jobId, member.id, outcome, member.salt);
    const signature = await member.wallet.signMessage(ethers.getBytes(commitHash));
    return mutate(app, csrf, 'post', `/jobs/${jobId}/commitments`)
      .send({ validatorId: member.id, commitHash, signature })
      .expect(expectedStatus);
  };

  const reveal = (jobId: string, member: Member, outcome: VerdictOutcome, salt = member.salt) =>
    mutate(app, csrf, 'post', `/jobs/${jobId}/reveals`).send({
      validatorId: member.id,
      outcome,
      salt,
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

    // The committee is drawn from every staked validator in the database.
    // Retire the ones other suites left behind so the draw can only land on
    // validators whose keys this suite holds.
    const existing = await request(app.getHttpServer()).get('/validators').expect(200);
    for (const validator of existing.body as Array<{ id: string; isActive: boolean }>) {
      if (validator.isActive) {
        await mutate(app, csrf, 'delete', `/validators/${validator.id}`).expect(200);
      }
    }

    committee = [];
    for (let i = 0; i < 3; i++) {
      const wallet = ethers.Wallet.createRandom();
      const res = await mutate(app, csrf, 'post', '/validators')
        .send({
          address: wallet.address,
          publicKey: wallet.signingKey.compressedPublicKey,
          stake: (10n * ETHER).toString(),
          endpoint: `http://committee-${i}:9090`,
        })
        .expect(201);
      committee.push({ id: res.body.id, wallet, salt: ethers.id(`salt-${i}-${randomUUID()}`) });
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('leaves a commit-reveal job pending with the whole committee assigned', async () => {
    const res = await submitJob('commit_reveal').expect(201);

    expect(res.body.verification.outcome).toBe('pending');
    expect(res.body.verification.verdictId).toBeNull();

    const job = await request(app.getHttpServer()).get(`/jobs/${res.body.job.id}`).expect(200);
    expect(job.body.status).toBe('in_progress');
    expect([...job.body.assignedValidators].sort()).toEqual(committee.map((m) => m.id).sort());
    expect(new Date(job.body.revealDeadline).getTime()).toBeGreaterThan(
      new Date(job.body.commitDeadline).getTime(),
    );

    const round = await request(app.getHttpServer())
      .get(`/jobs/${res.body.job.id}/commitments`)
      .expect(200);
    expect(round.body.phase).toBe('commit');
    expect(round.body.commitments).toEqual([]);
  });

  it('publishes the majority verdict after commit and reveal', async () => {
    const submitted = await submitJob('commit_reveal').expect(201);
    const jobId: string = submitted.body.job.id;
    const sessionId: string = submitted.body.job.sessionId;
    const [a, b, c] = committee;

    const first = await commit(jobId, a, VerdictOutcome.ACCEPT, 201);
    expect(first.body).toMatchObject({ validatorId: a.id, revealed: false, outcome: null });

    // Revealing now would show the vote to validators that can still commit.
    await reveal(jobId, a, VerdictOutcome.ACCEPT).expect(409);

    await commit(jobId, b, VerdictOutcome.REJECT, 201);
    await commit(jobId, c, VerdictOutcome.ACCEPT, 201);

    const open = await reveal(jobId, a, VerdictOutcome.ACCEPT).expect(201);
    expect(open.body.phase).toBe('reveal');
    await reveal(jobId, b, VerdictOutcome.REJECT).expect(201);
    await request(app.getHttpServer()).get(`/verdicts/${sessionId}`).expect(404);

    const closed = await reveal(jobId, c, VerdictOutcome.ACCEPT).expect(201);
    expect(closed.body.phase).toBe('finalized');
    expect(closed.body.tally.outcome).toBe('accept');
    expect(closed.body.tally.counts).toEqual({ accept: 2, partial: 0, reject: 1 });
    expect(JSON.stringify(closed.body)).not.toContain(a.salt);

    const verdict = await request(app.getHttpServer()).get(`/verdicts/${sessionId}`).expect(200);
    expect(verdict.body.outcome).toBe('accept');
    expect(verdict.body.jobId).toBe(jobId);
    expect([...verdict.body.signatures].sort()).toEqual([a.id, c.id].sort());

    const job = await request(app.getHttpServer()).get(`/jobs/${jobId}`).expect(200);
    expect(job.body.status).toBe('completed');

    // The round is over: nothing more can be committed, revealed or finalized twice.
    await commit(jobId, a, VerdictOutcome.REJECT, 409);
    await reveal(jobId, a, VerdictOutcome.ACCEPT).expect(409);
    const again = await mutate(app, csrf, 'post', `/jobs/${jobId}/finalize`).expect(200);
    expect(again.body.phase).toBe('finalized');
  });

  it('fails the job without a verdict when the committee splits', async () => {
    const submitted = await submitJob('commit_reveal').expect(201);
    const jobId: string = submitted.body.job.id;
    const [a, b, c] = committee;

    await commit(jobId, a, VerdictOutcome.ACCEPT, 201);
    await commit(jobId, b, VerdictOutcome.PARTIAL, 201);
    await commit(jobId, c, VerdictOutcome.REJECT, 201);
    await reveal(jobId, a, VerdictOutcome.ACCEPT).expect(201);
    await reveal(jobId, b, VerdictOutcome.PARTIAL).expect(201);
    const closed = await reveal(jobId, c, VerdictOutcome.REJECT).expect(201);

    expect(closed.body.phase).toBe('finalized');
    expect(closed.body.tally.outcome).toBeNull();

    const job = await request(app.getHttpServer()).get(`/jobs/${jobId}`).expect(200);
    expect(job.body.status).toBe('failed');
    await request(app.getHttpServer())
      .get(`/verdicts/${submitted.body.job.sessionId}`)
      .expect(404);
  });

  it('rejects a vote changed between commit and reveal', async () => {
    const submitted = await submitJob('commit_reveal').expect(201);
    const jobId: string = submitted.body.job.id;

    for (const member of committee) {
      await commit(jobId, member, VerdictOutcome.ACCEPT, 201);
    }

    await reveal(jobId, committee[0], VerdictOutcome.REJECT).expect(400);
    await reveal(jobId, committee[0], VerdictOutcome.ACCEPT, ethers.id('wrong salt')).expect(400);
    await reveal(jobId, committee[0], VerdictOutcome.ACCEPT).expect(201);
    await reveal(jobId, committee[0], VerdictOutcome.ACCEPT).expect(409);
  });

  it('rejects commitments that are duplicated, unsigned by the validator or from outsiders', async () => {
    const submitted = await submitJob('commit_reveal').expect(201);
    const jobId: string = submitted.body.job.id;
    const [a, b] = committee;

    await commit(jobId, a, VerdictOutcome.ACCEPT, 201);
    await commit(jobId, a, VerdictOutcome.ACCEPT, 409);

    // b's seat, signed with a's key.
    const forgedHash = computeCommitHash(jobId, b.id, VerdictOutcome.ACCEPT, b.salt);
    await mutate(app, csrf, 'post', `/jobs/${jobId}/commitments`)
      .send({
        validatorId: b.id,
        commitHash: forgedHash,
        signature: await a.wallet.signMessage(ethers.getBytes(forgedHash)),
      })
      .expect(403);

    const outsider: Member = {
      id: randomUUID(),
      wallet: ethers.Wallet.createRandom(),
      salt: ethers.id('outsider'),
    };
    await commit(jobId, outsider, VerdictOutcome.ACCEPT, 403);

    await mutate(app, csrf, 'post', `/jobs/${jobId}/commitments`)
      .send({ validatorId: a.id, commitHash: '0x1234', signature: '0x00' })
      .expect(400);

    // Commitments are still missing, so the round cannot be closed by hand.
    await mutate(app, csrf, 'post', `/jobs/${jobId}/finalize`).expect(409);
  });

  it('keeps instant jobs on the single-step path', async () => {
    const res = await submitJob().expect(201);

    expect(res.body.verification.outcome).toBe('accept');
    expect(res.body.verification.verdictId).toBeTruthy();
    expect(res.body.job.verdictMode).toBe('instant');

    await request(app.getHttpServer()).get(`/jobs/${res.body.job.id}/commitments`).expect(400);
    await commit(res.body.job.id, committee[0], VerdictOutcome.ACCEPT, 400);
  });

  it('rejects an unknown verdict mode', async () => {
    await submitJob('show_of_hands').expect(400);
  });
});
