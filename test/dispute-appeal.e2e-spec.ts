import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import { ethers } from 'ethers';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { appealVoteMessage, AppealVoteChoice } from '../src/modules/disputes/appeal-quorum';
import { CsrfSession, csrfSession, mutate } from './helpers/csrf';

/**
 * Dispute appeals end to end: a verdict signed by a committee of three is
 * disputed, the resolution is appealed, and a panel of seven other validators
 * decides with a two-thirds quorum.
 */
describe('Dispute appeal and quorum (e2e)', () => {
  let app: INestApplication;
  let csrf: CsrfSession;
  const wallets = new Map<string, ethers.HDNodeWallet>();

  const ETHER = 10n ** 18n;
  const COMMITTEE = 3;
  const PANEL = 7;
  const QUORUM = 5;

  const disputedVerdict = async (outcome?: 'upheld' | 'overturned') => {
    const sessionId = randomUUID();
    await mutate(app, csrf, 'post', '/jobs')
      .send({ sessionId, requestHash: ethers.id(`request-${sessionId}`), policyId: randomUUID() })
      .expect(201);
    const verdict = await request(app.getHttpServer()).get(`/verdicts/${sessionId}`).expect(200);
    const opened = await mutate(app, csrf, 'post', '/disputes')
      .send({ sessionId, reason: 'result does not match the request', initiator: 'did:prom:agent-a' })
      .expect(201);
    await mutate(app, csrf, 'patch', `/disputes/${opened.body.id}/resolve`)
      .send({ resolution: 'first-instance decision', ...(outcome ? { outcome } : {}) })
      .expect(200);
    return { disputeId: opened.body.id as string, signers: verdict.body.signatures as string[] };
  };

  const openAppeal = (disputeId: string) =>
    mutate(app, csrf, 'post', `/disputes/${disputeId}/appeal`).send({
      appellant: 'did:prom:agent-b',
      reason: 'the first-instance decision ignored the delivery log',
    });

  const castVote = async (
    disputeId: string,
    appealId: string,
    validatorId: string,
    vote: AppealVoteChoice,
    expectedStatus: number,
  ) => {
    const wallet = wallets.get(validatorId) as ethers.HDNodeWallet;
    const signature = await wallet.signMessage(appealVoteMessage(appealId, vote));
    return mutate(app, csrf, 'post', `/disputes/${disputeId}/appeal/votes`)
      .send({ validatorId, vote, signature })
      .expect(expectedStatus);
  };

  const dispute = async (disputeId: string) =>
    (await request(app.getHttpServer()).get(`/disputes/${disputeId}`).expect(200)).body;

  const proposals = async (disputeId: string) =>
    (await request(app.getHttpServer()).get('/slashing/proposals').query({ disputeId }).expect(200))
      .body as Array<{ status: string; decidedBy: string | null; validatorId: string }>;

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

    // Committees and panels are drawn from every staked validator in the
    // database. Retire what other suites left behind, then register exactly
    // enough validators for one committee and one full panel, all with keys
    // this suite holds.
    const existing = await request(app.getHttpServer()).get('/validators').expect(200);
    for (const validator of existing.body as Array<{ id: string; isActive: boolean }>) {
      if (validator.isActive) {
        await mutate(app, csrf, 'delete', `/validators/${validator.id}`).expect(200);
      }
    }
    for (let i = 0; i < COMMITTEE + PANEL; i++) {
      const wallet = ethers.Wallet.createRandom();
      const res = await mutate(app, csrf, 'post', '/validators')
        .send({
          address: wallet.address,
          publicKey: wallet.signingKey.compressedPublicKey,
          stake: (10n * ETHER).toString(),
          endpoint: `http://appeal-validator-${i}:9090`,
        })
        .expect(201);
      wallets.set(res.body.id, wallet);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('draws a panel of seven from validators that did not sign the verdict', async () => {
    const { disputeId, signers } = await disputedVerdict('overturned');
    expect(signers).toHaveLength(COMMITTEE);

    const appeal = await openAppeal(disputeId).expect(201);

    expect(appeal.body.panel).toHaveLength(PANEL);
    expect(appeal.body.quorum).toBe(QUORUM);
    expect(appeal.body.originalOutcome).toBe('overturned');
    expect(appeal.body.status).toBe('open');
    for (const signer of signers) expect(appeal.body.panel).not.toContain(signer);
    for (const member of appeal.body.panel) expect(wallets.has(member)).toBe(true);
    expect(appeal.body.tally).toEqual({
      uphold: 0,
      overturn: 0,
      panelSize: PANEL,
      quorum: QUORUM,
      decision: null,
    });

    expect((await dispute(disputeId)).status).toBe('appealed');
    const read = await request(app.getHttpServer()).get(`/disputes/${disputeId}/appeal`).expect(200);
    expect(read.body.id).toBe(appeal.body.id);
  });

  it('reverses an overturned verdict at the quorum and withdraws the slashing proposals', async () => {
    const { disputeId } = await disputedVerdict('overturned');
    expect((await proposals(disputeId)).map((p) => p.status)).toEqual(
      Array(COMMITTEE).fill('proposed'),
    );
    const appeal = await openAppeal(disputeId).expect(201);
    const panel: string[] = appeal.body.panel;

    // While the appeal is open the resolution is frozen but evidence is not.
    await mutate(app, csrf, 'patch', `/disputes/${disputeId}/resolve`)
      .send({ resolution: 'second thoughts' })
      .expect(409);
    await mutate(app, csrf, 'post', `/disputes/${disputeId}/evidence`)
      .send({
        submitter: 'did:prom:agent-b',
        uri: 'https://evidence.example.org/delivery-log.txt',
        contentHash: `0x${createHash('sha256').update(disputeId).digest('hex')}`,
      })
      .expect(201);

    for (const member of panel.slice(0, QUORUM - 1)) {
      const res = await castVote(disputeId, appeal.body.id, member, AppealVoteChoice.OVERTURN, 201);
      expect(res.body.status).toBe('open');
    }
    expect((await dispute(disputeId)).status).toBe('appealed');

    const decided = await castVote(
      disputeId,
      appeal.body.id,
      panel[QUORUM - 1],
      AppealVoteChoice.OVERTURN,
      201,
    );
    expect(decided.body).toMatchObject({ status: 'decided', decision: 'reversed' });
    expect(decided.body.tally).toMatchObject({ overturn: QUORUM, uphold: 0 });
    expect(decided.body.votes).toHaveLength(QUORUM);

    const after = await dispute(disputeId);
    expect(after.status).toBe('resolved');
    expect(after.outcome).toBe('upheld');
    expect(after.resolution).toContain('resolution reversed by the appeal panel');

    const withdrawn = await proposals(disputeId);
    expect(withdrawn).toHaveLength(COMMITTEE);
    for (const proposal of withdrawn) {
      expect(proposal.status).toBe('rejected');
      expect(proposal.decidedBy).toBe(`appeal:${appeal.body.id}`);
    }

    // One round only, and no more votes or evidence after the decision.
    await openAppeal(disputeId).expect(409);
    await castVote(disputeId, appeal.body.id, panel[QUORUM], AppealVoteChoice.UPHOLD, 409);
    const closed = await mutate(app, csrf, 'post', `/disputes/${disputeId}/appeal/close`).expect(200);
    expect(closed.body.decision).toBe('reversed');
  });

  it('raises slashing proposals when an upheld verdict falls on appeal', async () => {
    const { disputeId, signers } = await disputedVerdict('upheld');
    expect(await proposals(disputeId)).toEqual([]);
    const appeal = await openAppeal(disputeId).expect(201);

    for (const member of (appeal.body.panel as string[]).slice(0, QUORUM)) {
      await castVote(disputeId, appeal.body.id, member, AppealVoteChoice.OVERTURN, 201);
    }

    const after = await dispute(disputeId);
    expect(after).toMatchObject({ status: 'resolved', outcome: 'overturned' });
    const raised = await proposals(disputeId);
    expect(raised.map((p) => p.validatorId).sort()).toEqual([...signers].sort());
    expect(raised.every((p) => p.status === 'proposed')).toBe(true);
  });

  it('keeps the resolution when the panel cannot reach the quorum any more', async () => {
    const { disputeId } = await disputedVerdict('overturned');
    const appeal = await openAppeal(disputeId).expect(201);
    const panel: string[] = appeal.body.panel;

    // Four overturn votes are a majority of seven, but not two thirds.
    for (const member of panel.slice(0, 4)) {
      await castVote(disputeId, appeal.body.id, member, AppealVoteChoice.OVERTURN, 201);
    }
    await mutate(app, csrf, 'post', `/disputes/${disputeId}/appeal/close`).expect(409);
    await castVote(disputeId, appeal.body.id, panel[4], AppealVoteChoice.UPHOLD, 201);
    await castVote(disputeId, appeal.body.id, panel[5], AppealVoteChoice.UPHOLD, 201);
    const decided = await castVote(disputeId, appeal.body.id, panel[6], AppealVoteChoice.UPHOLD, 201);

    expect(decided.body).toMatchObject({ status: 'decided', decision: 'upheld' });
    expect(decided.body.tally).toMatchObject({ overturn: 4, uphold: 3 });
    const after = await dispute(disputeId);
    expect(after).toMatchObject({ status: 'resolved', outcome: 'overturned' });
    expect(after.resolution).toBe('first-instance decision');
    expect((await proposals(disputeId)).every((p) => p.status === 'proposed')).toBe(true);
  });

  it('accepts only signed votes from panel members, once each', async () => {
    const { disputeId, signers } = await disputedVerdict('overturned');
    const appeal = await openAppeal(disputeId).expect(201);
    const [first, second] = appeal.body.panel as string[];

    // A validator that signed the disputed verdict has no seat on the panel.
    await castVote(disputeId, appeal.body.id, signers[0], AppealVoteChoice.UPHOLD, 403);

    // A signature for "uphold" cannot be replayed as a vote to overturn.
    const upholdSignature = await (wallets.get(first) as ethers.HDNodeWallet).signMessage(
      appealVoteMessage(appeal.body.id, AppealVoteChoice.UPHOLD),
    );
    await mutate(app, csrf, 'post', `/disputes/${disputeId}/appeal/votes`)
      .send({ validatorId: first, vote: 'overturn', signature: upholdSignature })
      .expect(403);

    // Another panel member's key does not vote for this seat.
    const borrowed = await (wallets.get(second) as ethers.HDNodeWallet).signMessage(
      appealVoteMessage(appeal.body.id, AppealVoteChoice.OVERTURN),
    );
    await mutate(app, csrf, 'post', `/disputes/${disputeId}/appeal/votes`)
      .send({ validatorId: first, vote: 'overturn', signature: borrowed })
      .expect(403);

    await mutate(app, csrf, 'post', `/disputes/${disputeId}/appeal/votes`)
      .send({ validatorId: first, vote: 'abstain', signature: upholdSignature })
      .expect(400);

    await castVote(disputeId, appeal.body.id, first, AppealVoteChoice.UPHOLD, 201);
    await castVote(disputeId, appeal.body.id, first, AppealVoteChoice.OVERTURN, 409);

    const read = await request(app.getHttpServer()).get(`/disputes/${disputeId}/appeal`).expect(200);
    expect(read.body.votes).toEqual([
      expect.objectContaining({ validatorId: first, vote: 'uphold' }),
    ]);
  });

  it('only accepts appeals against a resolution with a recorded outcome', async () => {
    const sessionId = randomUUID();
    const open = await mutate(app, csrf, 'post', '/disputes')
      .send({ sessionId, reason: 'still being looked at', initiator: 'did:prom:agent-a' })
      .expect(201);
    await openAppeal(open.body.id).expect(409);
    await request(app.getHttpServer()).get(`/disputes/${open.body.id}/appeal`).expect(404);

    const unstated = await disputedVerdict();
    await openAppeal(unstated.disputeId).expect(409);

    await openAppeal(randomUUID()).expect(404);
    await mutate(app, csrf, 'post', '/disputes/not-a-uuid/appeal')
      .send({ appellant: 'did:prom:agent-b', reason: 'x' })
      .expect(400);
    const resolved = await disputedVerdict('upheld');
    await mutate(app, csrf, 'post', `/disputes/${resolved.disputeId}/appeal`)
      .send({ appellant: 'somebody', reason: '' })
      .expect(400);
  });

  it('refuses an appeal when too few independent validators are left for a panel', async () => {
    const { disputeId, signers } = await disputedVerdict('overturned');

    // Leave the three signers and three others: a panel of three would be no
    // larger than the committee it is supposed to review.
    const others = [...wallets.keys()].filter((id) => !signers.includes(id));
    for (const id of others.slice(COMMITTEE)) {
      await mutate(app, csrf, 'delete', `/validators/${id}`).expect(200);
    }

    await openAppeal(disputeId).expect(422);
    expect((await dispute(disputeId)).status).toBe('resolved');
  });
});
