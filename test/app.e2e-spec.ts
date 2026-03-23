import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Verification Network (e2e)', () => {
  let app: INestApplication;

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
      return request(app.getHttpServer())
        .post('/validators')
        .send({
          address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
          publicKey: '0x04c9d0e1f2a3b4',
          stake: '1000',
          endpoint: 'http://validator-1:9090',
          capabilities: ['verification'],
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.id).toBeDefined();
          expect(res.body.address).toBe('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
        });
    });

    it('should reject missing required fields', () => {
      return request(app.getHttpServer())
        .post('/validators')
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
