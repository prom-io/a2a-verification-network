import { ConfigService } from '@nestjs/config';
import { CoordinatorService } from '../coordinator/coordinator.service';
import { JobStatus, VerificationJob } from './entities/verification-job.entity';
import { JobQueueService } from './job-queue.service';
import { JobsService } from './jobs.service';
import { DEFAULT_PRIORITY_OPTIONS } from './priority';

const UNIT = DEFAULT_PRIORITY_OPTIONS.feeUnitWei;
const NOW = new Date('2026-05-01T12:00:00.000Z');

function pendingJob(id: string, feeUnits: number, waitedSeconds = 0): VerificationJob {
  return {
    id,
    fee: (BigInt(feeUnits) * UNIT).toString(),
    status: JobStatus.PENDING,
    submittedAt: new Date(NOW.getTime() - waitedSeconds * 1000),
  } as VerificationJob;
}

function build(jobs: VerificationJob[], env: Record<string, unknown> = {}) {
  const jobsService = {
    // Stands in for the database, which cuts the queue off after `limit`
    // jobs in priority order. None of the limited cases below involve
    // waiting time, so ordering by fee is enough here.
    findPendingByPriority: jest.fn(async (limit: number) =>
      jobs
        .filter((job) => job.status === JobStatus.PENDING)
        .sort((a, b) => (BigInt(b.fee) > BigInt(a.fee) ? 1 : -1))
        .slice(0, limit),
    ),
    claimPending: jest.fn(async (id: string) => {
      const job = jobs.find((j) => j.id === id);
      if (!job || job.status !== JobStatus.PENDING) return false;
      job.status = JobStatus.ASSIGNED;
      return true;
    }),
    updateStatus: jest.fn(async (id: string, status: JobStatus) => {
      const job = jobs.find((j) => j.id === id) as VerificationJob;
      job.status = status;
      return job;
    }),
  };
  const processed: string[] = [];
  const coordinator = {
    processJob: jest.fn(async (id: string) => {
      processed.push(id);
      (jobs.find((j) => j.id === id) as VerificationJob).status = JobStatus.COMPLETED;
      return { jobId: id, sessionId: `session-${id}`, outcome: 'accept', verdictId: `verdict-${id}` };
    }),
  };
  const config = { get: jest.fn((key: string, fallback?: unknown) => env[key] ?? fallback) };
  const service = new JobQueueService(
    jobsService as unknown as JobsService,
    coordinator as unknown as CoordinatorService,
    config as unknown as ConfigService,
  );
  return { service, jobsService, coordinator, processed };
}

describe('JobQueueService.list', () => {
  it('orders pending jobs by fee and waiting time', async () => {
    const { service } = build([
      pendingJob('free', 0),
      pendingJob('premium', 10),
      pendingJob('standard', 2),
      pendingJob('patient', 0, 300),
    ]);

    const queue = await service.list(50, NOW);

    expect(queue.map((entry) => [entry.position, entry.job.id, entry.score])).toEqual([
      [1, 'premium', 10],
      [2, 'patient', 5],
      [3, 'standard', 2],
      [4, 'free', 0],
    ]);
    expect(queue[1].waitedSeconds).toBe(300);
  });

  it('passes the configured fee unit and aging to the query and the ordering', async () => {
    const { service, jobsService } = build([pendingJob('a', 1), pendingJob('b', 3)], {
      JOB_QUEUE_FEE_UNIT_WEI: (2n * UNIT).toString(),
      JOB_QUEUE_AGING_SECONDS: '0',
    });

    const queue = await service.list(5, NOW);

    expect(jobsService.findPendingByPriority).toHaveBeenCalledWith(5, {
      feeUnitWei: 2n * UNIT,
      agingSeconds: 0,
    });
    expect(queue.map((entry) => entry.score)).toEqual([1.5, 0.5]);
  });

  it('falls back to the defaults for a malformed configuration', async () => {
    const { service, jobsService } = build([], {
      JOB_QUEUE_FEE_UNIT_WEI: 'a lot',
      JOB_QUEUE_AGING_SECONDS: 'soon',
    });

    await service.list(5, NOW);

    expect(jobsService.findPendingByPriority).toHaveBeenCalledWith(5, DEFAULT_PRIORITY_OPTIONS);
  });
});

describe('JobQueueService.drain', () => {
  it('processes the head of the queue in priority order', async () => {
    const { service, processed } = build([
      pendingJob('free', 0),
      pendingJob('premium', 10),
      pendingJob('standard', 2),
    ]);

    const results = await service.drain(2, NOW);

    expect(processed).toEqual(['premium', 'standard']);
    expect(results).toEqual([
      { jobId: 'premium', outcome: 'accept', verdictId: 'verdict-premium' },
      { jobId: 'standard', outcome: 'accept', verdictId: 'verdict-standard' },
    ]);
    expect((await service.list(50, NOW)).map((entry) => entry.job.id)).toEqual(['free']);
  });

  it('skips a job another instance has already claimed', async () => {
    const { service, jobsService, processed } = build([pendingJob('a', 5), pendingJob('b', 1)]);
    jobsService.claimPending.mockResolvedValueOnce(false);

    const results = await service.drain(10, NOW);

    expect(processed).toEqual(['b']);
    expect(results.map((result) => result.jobId)).toEqual(['b']);
  });

  it('marks a failing job as failed and keeps draining', async () => {
    const { service, coordinator, jobsService, processed } = build([
      pendingJob('poisoned', 9),
      pendingJob('healthy', 1),
    ]);
    coordinator.processJob.mockRejectedValueOnce(new Error('policy not found'));

    const results = await service.drain(10, NOW);

    expect(results).toEqual([
      { jobId: 'poisoned', outcome: 'failed', error: 'policy not found' },
      { jobId: 'healthy', outcome: 'accept', verdictId: 'verdict-healthy' },
    ]);
    expect(jobsService.updateStatus).toHaveBeenCalledWith('poisoned', JobStatus.FAILED);
    expect(processed).toEqual(['healthy']);
  });

  it('does not run two drains at the same time', async () => {
    const { service, processed } = build([pendingJob('a', 2), pendingJob('b', 1)]);

    const [first, second] = await Promise.all([service.drain(10, NOW), service.drain(10, NOW)]);

    expect(first).toHaveLength(2);
    expect(second).toEqual([]);
    expect(processed).toEqual(['a', 'b']);
    // The guard is released afterwards.
    expect(await service.drain(10, NOW)).toEqual([]);
  });

  it('returns nothing for an empty queue', async () => {
    const { service, coordinator } = build([]);

    expect(await service.drain(10, NOW)).toEqual([]);
    expect(coordinator.processJob).not.toHaveBeenCalled();
  });
});

describe('JobQueueService poller', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stays off unless a poll interval is configured', () => {
    const { service, jobsService } = build([pendingJob('a', 1)]);

    service.onModuleInit();
    jest.advanceTimersByTime(60_000);

    expect(jobsService.findPendingByPriority).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('drains a batch on every tick and stops on shutdown', async () => {
    const { service, jobsService } = build([pendingJob('a', 1)], {
      JOB_QUEUE_POLL_MS: '1000',
      JOB_QUEUE_BATCH_SIZE: '3',
    });

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1000);
    expect(jobsService.findPendingByPriority).toHaveBeenCalledTimes(1);
    expect(jobsService.findPendingByPriority).toHaveBeenCalledWith(3, DEFAULT_PRIORITY_OPTIONS);

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5000);
    expect(jobsService.findPendingByPriority).toHaveBeenCalledTimes(1);
  });
});
