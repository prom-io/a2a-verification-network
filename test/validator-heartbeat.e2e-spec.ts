import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ethers } from 'ethers';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { heartbeatMessage } from '../src/modules/validators/validator-availability.service';
import { CsrfSession, csrfSession, mutate } from './helpers/csrf';

/**
 * Heartbeats and auto-suspension against the real schema. The timeout is cut
 * to one second for this suite so a validator can actually go stale; the
 * sweep it triggers suspends every silent validator in the database, which is
 * fine because each suite registers the validators it needs.
 */
describe('Validator heartbeat and auto-suspension (e2e)', () => {
  let app: INestApplication;
  let csrf: CsrfSession;
  const previousTimeout = process.env.HEARTBEAT_TIMEOUT_SECONDS;

  const ETHER = 10n ** 18n;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const register = async () => {
    const wallet = ethers.Wallet.createRandom();
    const res = await mutate(app, csrf, 'post', '/validators')
      .send({
        address: wallet.address,
        publicKey: wallet.signingKey.compressedPublicKey,
        stake: (10n * ETHER).toString(),
        endpoint: 'http://heartbeat-validator:9090',
      })
      .expect(201);
    return { id: res.body.id as string, wallet };
  };

  const beat = async (
    validator: { id: string; wallet: ethers.HDNodeWallet },
    expectedStatus: number,
    timestamp = Date.now(),
    signer = validator.wallet,
  ) =>
    mutate(app, csrf, 'post', `/validators/${validator.id}/heartbeat`)
      .send({
        timestamp,
        signature: await signer.signMessage(heartbeatMessage(validator.id, timestamp)),
      })
      .expect(expectedStatus);

  const sweep = async () =>
    (await mutate(app, csrf, 'post', '/validators/suspensions/sweep').expect(200)).body
      .suspended as string[];

  beforeAll(async () => {
    process.env.HEARTBEAT_TIMEOUT_SECONDS = '1';
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
    if (previousTimeout === undefined) delete process.env.HEARTBEAT_TIMEOUT_SECONDS;
    else process.env.HEARTBEAT_TIMEOUT_SECONDS = previousTimeout;
    await app?.close();
  });

  it('records a signed heartbeat', async () => {
    const validator = await register();
    const timestamp = Date.now();

    const res = await beat(validator, 200, timestamp);

    expect(res.body).toMatchObject({ validatorId: validator.id, isActive: true, reactivated: false });
    expect(new Date(res.body.lastHeartbeatAt).getTime()).toBe(timestamp);
    expect(new Date(res.body.heartbeatDueBy).getTime()).toBe(timestamp + 1000);

    const availability = await request(app.getHttpServer())
      .get(`/validators/${validator.id}/availability`)
      .expect(200);
    expect(new Date(availability.body.lastHeartbeatAt).getTime()).toBe(timestamp);
    expect(availability.body.suspendedAt).toBeNull();
  });

  it('rejects forged, stale, replayed and malformed heartbeats', async () => {
    const validator = await register();
    const impostor = ethers.Wallet.createRandom();

    await beat(validator, 403, Date.now(), impostor);
    await beat(validator, 400, Date.now() - 10 * 60 * 1000);
    await mutate(app, csrf, 'post', `/validators/${validator.id}/heartbeat`)
      .send({ timestamp: 'now', signature: '0x00' })
      .expect(400);

    const timestamp = Date.now();
    await beat(validator, 200, timestamp);
    await beat(validator, 409, timestamp);
    await beat(validator, 409, timestamp - 5);
  });

  it('suspends a silent validator, drops it from committees and reactivates it on heartbeat', async () => {
    const silent = await register();
    const alive = await register();

    await sleep(1300);
    await beat(alive, 200);
    const suspended = await sweep();

    expect(suspended).toContain(silent.id);
    expect(suspended).not.toContain(alive.id);

    const availability = await request(app.getHttpServer())
      .get(`/validators/${silent.id}/availability`)
      .expect(200);
    expect(availability.body).toMatchObject({
      isActive: false,
      suspensionReason: 'missed_heartbeat',
      heartbeatDueBy: null,
      exitedAt: null,
    });
    expect(availability.body.suspendedAt).not.toBeNull();

    // Only the validator that reported in is left to be drawn.
    const sessionId = ethers.uuidV4(ethers.randomBytes(16));
    await mutate(app, csrf, 'post', '/jobs')
      .send({
        sessionId,
        requestHash: ethers.id(sessionId),
        policyId: ethers.uuidV4(ethers.randomBytes(16)),
      })
      .expect(201);
    const verdict = await request(app.getHttpServer()).get(`/verdicts/${sessionId}`).expect(200);
    expect(verdict.body.signatures).toEqual([alive.id]);

    const back = await beat(silent, 200);
    expect(back.body).toMatchObject({ isActive: true, reactivated: true, suspendedAt: null });
    expect(await sweep()).not.toContain(silent.id);
  });

  it('does not let a heartbeat undo an exit', async () => {
    const validator = await register();
    const exited = await mutate(app, csrf, 'delete', `/validators/${validator.id}`).expect(200);
    expect(exited.body.exitedAt).not.toBeNull();

    await beat(validator, 409);

    const availability = await request(app.getHttpServer())
      .get(`/validators/${validator.id}/availability`)
      .expect(200);
    expect(availability.body.isActive).toBe(false);
    expect(await sweep()).not.toContain(validator.id);
  });
});
