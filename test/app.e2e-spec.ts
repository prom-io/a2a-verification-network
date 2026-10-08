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
