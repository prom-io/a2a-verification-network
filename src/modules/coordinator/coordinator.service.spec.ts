import { CoordinatorService, DEFAULT_COMMITTEE_SIZE } from './coordinator.service';
import { JobsService } from '../jobs/jobs.service';
import { ValidatorsService } from '../validators/validators.service';
import { VerdictsService } from '../verdicts/verdicts.service';
import { JobStatus } from '../jobs/entities/verification-job.entity';
import { StakingTier, selectWeighted } from '../validators/staking-tiers';

function build(eligible: Array<{ id: string; tier: StakingTier; weight: number }>) {
  const job = {
    id: 'job-1',
    sessionId: 'session-1',
    requestHash: '0xrequest',
    resultHash: '',
    status: JobStatus.PENDING,
  };
  const jobs = {
    findOne: jest.fn().mockResolvedValue(job),
    updateStatus: jest.fn().mockResolvedValue(job),
    assignValidators: jest.fn().mockResolvedValue(job),
  };
  const validators = { findEligible: jest.fn().mockResolvedValue(eligible) };
  const verdicts = {
    createAndPublish: jest.fn().mockResolvedValue({ id: 'verdict-1', txHash: undefined }),
  };
  const service = new CoordinatorService(
    jobs as unknown as JobsService,
    validators as unknown as ValidatorsService,
    verdicts as unknown as VerdictsService,
  );
  return { service, jobs, validators, verdicts };
}

const pool = [
  { id: 'bronze-1', tier: StakingTier.BRONZE, weight: 1 },
  { id: 'bronze-2', tier: StakingTier.BRONZE, weight: 1 },
  { id: 'silver-1', tier: StakingTier.SILVER, weight: 2 },
  { id: 'gold-1', tier: StakingTier.GOLD, weight: 4 },
  { id: 'platinum-1', tier: StakingTier.PLATINUM, weight: 8 },
];

describe('CoordinatorService committee assignment', () => {
  it('draws a committee of the default size from the eligible validators', async () => {
    const { service, jobs } = build(pool);

    const selected = await service.assignValidators('job-1');

    expect(selected).toHaveLength(DEFAULT_COMMITTEE_SIZE);
    expect(new Set(selected).size).toBe(DEFAULT_COMMITTEE_SIZE);
    expect(jobs.assignValidators).toHaveBeenCalledWith('job-1', selected);
  });

  it('seeds the draw with the job id so it can be recomputed', async () => {
    const { service } = build(pool);

    expect(await service.assignValidators('job-42')).toEqual(selectWeighted(pool, 3, 'job-42'));
    expect(await service.assignValidators('job-42')).toEqual(await service.assignValidators('job-42'));
  });

  it('favours higher tiers across many jobs', async () => {
    const { service } = build(pool);
    const seats: Record<string, number> = {};

    for (let i = 0; i < 400; i++) {
      for (const id of await service.assignValidators(`job-${i}`, 1)) {
        seats[id] = (seats[id] ?? 0) + 1;
      }
    }

    expect(seats['platinum-1']).toBeGreaterThan(seats['gold-1']);
    expect(seats['gold-1']).toBeGreaterThan(seats['silver-1']);
    expect(seats['silver-1']).toBeGreaterThan(seats['bronze-1']);
  });

  it('honours a requested committee size', async () => {
    const { service } = build(pool);

    expect(await service.assignValidators('job-1', 5)).toHaveLength(5);
  });

  it('falls back to the service itself when nobody is staked', async () => {
    const { service, jobs } = build([]);

    expect(await service.assignValidators('job-1')).toEqual(['self-validator']);
    expect(jobs.assignValidators).toHaveBeenCalledWith('job-1', ['self-validator']);
  });

  it('publishes the verdict with the assigned committee and completes the job', async () => {
    const { service, jobs, verdicts } = build(pool);

    const result = await service.processJob('job-1');

    const committee = selectWeighted(pool, 3, 'job-1');
    expect(verdicts.createAndPublish).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', sessionId: 'session-1', validatorIds: committee }),
    );
    expect(jobs.updateStatus).toHaveBeenLastCalledWith('job-1', JobStatus.COMPLETED);
    expect(result).toMatchObject({ jobId: 'job-1', verdictId: 'verdict-1', outcome: 'accept' });
  });

  it('reports quorum once the job is completed', async () => {
    const { service, jobs } = build(pool);

    expect(await service.checkQuorum('job-1')).toBe(false);
    jobs.findOne.mockResolvedValue({ id: 'job-1', status: JobStatus.COMPLETED });
    expect(await service.checkQuorum('job-1')).toBe(true);
  });
});
