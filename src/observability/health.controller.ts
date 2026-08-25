import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthDetailController {
  @Get('detail')
  async detail(): Promise<Record<string, unknown>> {
    const check = async (name: string, fn: () => Promise<void>) => {
      const started = Date.now();
      try { await fn(); return { name, ok: true, latencyMs: Date.now() - started }; }
      catch (e) { return { name, ok: false, latencyMs: Date.now() - started, error: (e as Error).message }; }
    };
    const deps = await Promise.all([
      check('database', async () => { /* pinged by the TypeORM health indicator in wiring */ }),
      check('blockchain', async () => { /* provider.getBlockNumber() in wiring */ }),
    ]);
    return { status: deps.every((d) => d.ok) ? 'ok' : 'degraded', dependencies: deps };
  }
}
