import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ethers } from 'ethers';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CsrfSession, csrfSession, mutate } from './helpers/csrf';

describe('Verification Network (e2e)', () => {
  let app: INestApplication;
  let csrf: CsrfSession;

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
    await app.close();
  });

  describe('/health (GET)', () => {
    it('should return ok', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
          expect(res.body.service).toBe('a2a-verification-network');
        });
    });
  });

  describe('/validators (POST)', () => {
    it('should register a validator', () => {
      // A fresh address per run: the column is unique and the suite must be
      // repeatable against a database that is not dropped between runs.
      const wallet = ethers.Wallet.createRandom();
      return mutate(app, csrf, 'post', '/validators')
        .send({
          address: wallet.address,
          publicKey: wallet.signingKey.compressedPublicKey,
          stake: '1000',
          endpoint: 'http://validator-1:9090',
          capabilities: ['verification'],
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.id).toBeDefined();
          expect(res.body.address).toBe(wallet.address);
        });
    });

    it('should reject missing required fields', () => {
      return mutate(app, csrf, 'post', '/validators')
        .send({ address: '0xabc' })
        .expect(400);
    });
  });

  describe('staking tiers', () => {
    const ETHER = 10n ** 18n;

    it('publishes the tier table', async () => {
      const res = await request(app.getHttpServer()).get('/validators/tiers').expect(200);

      expect(res.body.map((t: { tier: string }) => t.tier)).toEqual([
        'bronze',
        'silver',
        'gold',
        'platinum',
      ]);
      expect(res.body[0]).toEqual({ tier: 'bronze', minStakeWei: ETHER.toString(), weight: 1 });
    });

    it('stores a whole-token stake and moves the validator between tiers', async () => {
      const wallet = ethers.Wallet.createRandom();
      const registered = await mutate(app, csrf, 'post', '/validators')
        .send({
          address: wallet.address,
          publicKey: wallet.signingKey.compressedPublicKey,
          stake: (5n * ETHER).toString(),
          endpoint: 'http://validator-2:9090',
        })
        .expect(201);
      expect(registered.body.tier).toBe('silver');

      const promoted = await mutate(app, csrf, 'patch', `/validators/${registered.body.id}/stake`)
        .send({ stake: (100n * ETHER).toString() })
        .expect(200);
      expect(promoted.body.tier).toBe('platinum');

      const read = await request(app.getHttpServer())
        .get(`/validators/${registered.body.id}`)
        .expect(200);
      expect(read.body.stake).toBe((100n * ETHER).toString());
      expect(read.body.tier).toBe('platinum');
    });

    it('rejects a stake that is not an integer amount of wei', async () => {
      const wallet = ethers.Wallet.createRandom();
      const registered = await mutate(app, csrf, 'post', '/validators')
        .send({
          address: wallet.address,
          publicKey: wallet.signingKey.compressedPublicKey,
          stake: '1',
          endpoint: 'http://validator-3:9090',
        })
        .expect(201);
      expect(registered.body.tier).toBe('none');

      await mutate(app, csrf, 'patch', `/validators/${registered.body.id}/stake`)
        .send({ stake: '1.5' })
        .expect(400);
    });
  });

  describe('/validators (GET)', () => {
    it('should list validators', () => {
      return request(app.getHttpServer())
        .get('/validators')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });
});
