import { ConfigService } from '@nestjs/config';
import { JobsService } from '../jobs/jobs.service';
import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import { CommitRevealService } from './commit-reveal.service';
import { QuorumTimeoutService } from './quorum-timeout.service';

const NOW = new Date('2026-05-01T12:00:00.000Z');

function build(settings: Record<string, unknown> = {}) {
  const jobs = {
    findExpiredRounds: jest.fn(async () => [{ id: 'decided' }, { id: 'widened' }, { id: 'failed' }]),
  };
  const rounds: Record<string, { phase: string; tally: { outcome: VerdictOutcome | null } }> = {
    decided: { phase: 'finalized', tally: { outcome: VerdictOutcome.ACCEPT } },
    widened: { phase: 'commit', tally: { outcome: null } },
    failed: { phase: 'finalized', tally: { outcome: null } },
  };
  const commitReveal = {
    finalize: jest.fn(async (jobId: string) => {
      if (!rounds[jobId]) throw new Error(`Job ${jobId} not found`);
      return rounds[jobId];
    }),
  };
  const config = { get: jest.fn((key: string, fallback?: unknown) => settings[key] ?? fallback) };
  const service = new QuorumTimeoutService(
    jobs as unknown as JobsService,
    commitReveal as unknown as CommitRevealService,
    config as unknown as ConfigService,
  );
  return { service, jobs, commitReveal };
}

describe('QuorumTimeoutService', () => {
  it('closes every expired round and reports what became of it', async () => {
    const { service, jobs, commitReveal } = build();

    const result = await service.sweep(NOW, 20);

    expect(jobs.findExpiredRounds).toHaveBeenCalledWith(NOW, 20);
    expect(commitReveal.finalize).toHaveBeenCalledTimes(3);
    expect(commitReveal.finalize).toHaveBeenCalledWith('decided', NOW);
    expect(result).toEqual({
      completed: ['decided'],
      expanded: ['widened'],
      failed: ['failed'],
      errors: [],
    });
  });

  it('keeps going when one round cannot be closed', async () => {
    const { service, jobs } = build();
    jobs.findExpiredRounds.mockResolvedValueOnce([{ id: 'missing' }, { id: 'decided' }]);

    const result = await service.sweep(NOW);

    expect(result.errors).toEqual([{ jobId: 'missing', error: 'Job missing not found' }]);
    expect(result.completed).toEqual(['decided']);
  });

  it('does not run two sweeps at once', async () => {
    const { service, jobs } = build();
    let release: (value: Array<{ id: string }>) => void = () => undefined;
    jobs.findExpiredRounds.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

    const first = service.sweep(NOW);
    const second = await service.sweep(NOW);
    release([]);
    await first;

    expect(second).toEqual({ completed: [], expanded: [], failed: [], errors: [] });
    expect(jobs.findExpiredRounds).toHaveBeenCalledTimes(1);
  });

  describe('timer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('sweeps on the configured interval until shutdown', async () => {
      const { service, jobs } = build({ 'quorum.timeoutSweepMs': 1000 });
      jobs.findExpiredRounds.mockResolvedValue([]);

      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(3000);
      expect(jobs.findExpiredRounds).toHaveBeenCalledTimes(3);

      service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(3000);
      expect(jobs.findExpiredRounds).toHaveBeenCalledTimes(3);
    });

    it('stays off by default', async () => {
      const { service, jobs } = build();

      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(60_000);

      expect(jobs.findExpiredRounds).not.toHaveBeenCalled();
    });
  });
});
