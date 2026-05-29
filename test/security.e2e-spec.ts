import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { RolesGuard } from '../src/common/auth/roles.guard';
import { Role } from '../src/common/auth/roles.enum';
import { JwtAuthGuard } from '../src/common/auth/jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';

describe('Security hardening (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns secure response headers', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('rejects POST without CSRF token', async () => {
    const res = await request(app.getHttpServer()).post('/validators').send({
      address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      publicKey: '0x04c9d0e1f2a3b4',
      stake: '1000',
      endpoint: 'http://validator-1:9090',
      capabilities: ['verification'],
    });
    expect([400, 403]).toContain(res.status);
  });
});

describe('Security guards', () => {
  it('RolesGuard rejects user without role metadata match', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: Role.SERVICE } }),
      }),
    } as any;

    expect(() => guard.canActivate(context)).toThrow('Requires one of roles');
  });

  it('JwtAuthGuard bypasses auth for @Public metadata', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => key === IS_PUBLIC_KEY),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;

    expect(guard.canActivate(context)).toBe(true);
  });
});
