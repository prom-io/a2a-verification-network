import { registerAs } from '@nestjs/config';

export default registerAs('security', () => ({
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  throttle: {
    shortTtl: parseInt(process.env.THROTTLE_SHORT_TTL ?? '1000', 10),
    shortLimit: parseInt(process.env.THROTTLE_SHORT_LIMIT ?? '10', 10),
    longTtl: parseInt(process.env.THROTTLE_LONG_TTL ?? '60000', 10),
    longLimit: parseInt(process.env.THROTTLE_LONG_LIMIT ?? '100', 10),
  },
  cors: {
    origins: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  },
  headers: {
    hsts: process.env.HSTS_ENABLED !== 'false',
    csp: process.env.CSP_POLICY ?? "default-src 'self'",
  },
  csrf: {
    secret: process.env.CSRF_SECRET ?? 'dev-csrf-secret-change-me',
    cookieName: process.env.CSRF_COOKIE_NAME ?? 'csrf-token',
    headerName: process.env.CSRF_HEADER_NAME ?? 'x-csrf-token',
  },
  auth: {
    passwordMinLength: parseInt(process.env.AUTH_PASSWORD_MIN_LENGTH ?? '12', 10),
  },
  validators: {
    minStakeWei: process.env.VALIDATOR_MIN_STAKE_WEI ?? '1000000000000000000',
    slashingEnabled: process.env.SLASHING_ENABLED !== 'false',
  },
}));
