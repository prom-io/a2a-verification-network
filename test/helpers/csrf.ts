import { INestApplication } from '@nestjs/common';
import request from 'supertest';

export interface CsrfSession {
  token: string;
  cookie: string;
}

/**
 * Obtains a signed double-submit token the way a browser client does: any safe
 * request returns it both as a cookie and in the X-CSRF-Token header.
 */
export async function csrfSession(app: INestApplication): Promise<CsrfSession> {
  const res = await request(app.getHttpServer()).get('/health');
  const token = res.headers['x-csrf-token'] as string;
  if (!token) throw new Error('GET /health did not issue a CSRF token');
  return { token, cookie: `csrf-token=${token}` };
}

/** Mutating request carrying the CSRF header and cookie. */
export function mutate(
  app: INestApplication,
  session: CsrfSession,
  method: 'post' | 'patch' | 'put' | 'delete',
  url: string,
) {
  const agent = request(app.getHttpServer());
  return agent[method](url)
    .set('x-csrf-token', session.token)
    .set('Cookie', session.cookie);
}
