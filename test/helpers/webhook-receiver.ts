import { createServer, IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';

export interface ReceivedWebhook {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** What the receiver answers on a path: a status, optionally with headers. */
export interface ScriptedAnswer {
  status: number;
  headers?: Record<string, string>;
}

/**
 * An HTTP endpoint on the loopback interface standing in for a job submitter.
 * Answers can be scripted per path, either as one fixed answer or as a list
 * consumed one request at a time (the last one repeats).
 */
export class WebhookReceiver {
  readonly received: ReceivedWebhook[] = [];
  private readonly script = new Map<string, ScriptedAnswer[]>();
  private server?: Server;
  url = '';

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const path = req.url ?? '/';
        this.received.push({ path, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        const queue = this.script.get(path) ?? [];
        const answer = (queue.length > 1 ? queue.shift() : queue[0]) ?? { status: 204 };
        res.writeHead(answer.status, answer.headers ?? {});
        res.end();
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  answer(path: string, ...answers: Array<number | ScriptedAnswer>): void {
    this.script.set(
      path,
      answers.map((answer) => (typeof answer === 'number' ? { status: answer } : answer)),
    );
  }

  on(path: string): ReceivedWebhook[] {
    return this.received.filter((call) => call.path === path);
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => (this.server ? this.server.close(resolve) : resolve(undefined)));
  }
}

/** Polls until the check returns a value, or fails after the timeout. */
export async function eventually<T>(
  check: () => Promise<T | undefined | null | false>,
  what: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
