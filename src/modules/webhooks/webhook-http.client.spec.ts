import { createServer, IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';
import { WebhookHttpClient } from './webhook-http.client';

/**
 * The client against a real socket: what reaches the receiver, what comes
 * back, and how failures are reported to the retry logic.
 */
describe('WebhookHttpClient', () => {
  let server: Server;
  let base: string;
  const seen: Array<{ method?: string; headers: IncomingHttpHeaders; body: string }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        seen.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
        switch (req.url) {
          case '/busy':
            res.writeHead(503, { 'retry-after': '120' });
            return res.end('try later');
          case '/moved':
            res.writeHead(302, { location: 'http://169.254.169.254/latest' });
            return res.end();
          case '/slow':
            setTimeout(() => res.writeHead(200).end(), 500);
            return;
          default:
            res.writeHead(204);
            return res.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const client = new WebhookHttpClient();

  it('posts the body with the given headers', async () => {
    const response = await client.post(`${base}/ok`, '{"a":1}', { 'x-prom-delivery': 'd-1' }, 2000);

    expect(response).toEqual({ status: 204, retryAfter: null });
    const last = seen[seen.length - 1];
    expect(last).toMatchObject({ method: 'POST', body: '{"a":1}' });
    expect(last.headers['x-prom-delivery']).toBe('d-1');
  });

  it('hands back the status and Retry-After of an error answer', async () => {
    expect(await client.post(`${base}/busy`, '{}', {}, 2000)).toEqual({
      status: 503,
      retryAfter: '120',
    });
  });

  it('does not follow redirects', async () => {
    const before = seen.length;

    expect((await client.post(`${base}/moved`, '{}', {}, 2000)).status).toBe(302);
    expect(seen.length).toBe(before + 1);
  });

  it('gives up after the timeout', async () => {
    await expect(client.post(`${base}/slow`, '{}', {}, 50)).rejects.toThrow('timed out after 50ms');
  });

  it('reports a refused connection by its error code', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    await expect(client.post(`http://127.0.0.1:${port}/`, '{}', {}, 2000)).rejects.toThrow(
      'ECONNREFUSED',
    );
  });
});
