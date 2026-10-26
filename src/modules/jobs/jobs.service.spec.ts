import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { JobStatus, VerdictMode, VerificationJob } from './entities/verification-job.entity';
import { JobsService } from './jobs.service';

function build(env: Record<string, string> = {}) {
  const rows: VerificationJob[] = [];
  const repo = {
    create: jest.fn((data: Partial<VerificationJob>) => ({ ...data }) as VerificationJob),
    save: jest.fn(async (job: VerificationJob) => {
      if (!job.id) {
        job.id = `job-${rows.length + 1}`;
        rows.push(job);
      }
      return job;
    }),
    findOneBy: jest.fn(async (where: Partial<VerificationJob>) =>
      rows.find((row) =>
        Object.entries(where).every(([key, value]) => row[key as keyof VerificationJob] === value),
      ) ?? null,
    ),
    find: jest.fn(async () => rows),
    findBy: jest.fn(async ({ status }: { status: JobStatus }) =>
      rows.filter((row) => row.status === status),
    ),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => env[key] ?? fallback),
  };
  const service = new JobsService(
    repo as unknown as Repository<VerificationJob>,
    config as unknown as ConfigService,
  );
  return { service, rows };
}

const dto = {
  sessionId: '7f1f6f0e-5a0b-4f0e-9a43-0d5a4d7a3b11',
  requestHash: `0x${'11'.repeat(32)}`,
  policyId: '0e3a2f1c-6b7d-4c8e-9f10-2a3b4c5d6e7f',
};

describe('JobsService', () => {
  it('submits a pending job in instant mode by default', async () => {
    const { service } = build();

    const job = await service.submit(dto);

    expect(job).toMatchObject({
      status: JobStatus.PENDING,
      verdictMode: VerdictMode.INSTANT,
      resultHash: '',
      artifactsRef: null,
    });
  });

  it('keeps the requested verdict mode', async () => {
    const { service } = build();

    const job = await service.submit({ ...dto, verdictMode: VerdictMode.COMMIT_REVEAL });

    expect(job.verdictMode).toBe(VerdictMode.COMMIT_REVEAL);
  });

  it('does not set phase deadlines for instant jobs', async () => {
    const { service } = build();
    const job = await service.submit(dto);

    const assigned = await service.assignValidators(job.id, ['v1', 'v2']);

    expect(assigned.status).toBe(JobStatus.ASSIGNED);
    expect(assigned.assignedValidators).toEqual(['v1', 'v2']);
    expect(assigned.commitDeadline).toBeUndefined();
    expect(assigned.revealDeadline).toBeUndefined();
  });

  it('starts the commit and reveal windows when the committee is assigned', async () => {
    const { service } = build();
    const job = await service.submit({ ...dto, verdictMode: VerdictMode.COMMIT_REVEAL });

    const before = Date.now();
    const assigned = await service.assignValidators(job.id, ['v1', 'v2', 'v3']);
    const after = Date.now();

    const commit = assigned.commitDeadline!.getTime();
    const reveal = assigned.revealDeadline!.getTime();
    expect(commit).toBeGreaterThanOrEqual(before + 300_000);
    expect(commit).toBeLessThanOrEqual(after + 300_000);
    expect(reveal - commit).toBe(300_000);
  });

  it('takes the phase lengths from the configuration', async () => {
    const { service } = build({ COMMIT_PHASE_SECONDS: '60', REVEAL_PHASE_SECONDS: '30' });
    const job = await service.submit({ ...dto, verdictMode: VerdictMode.COMMIT_REVEAL });

    const before = Date.now();
    const assigned = await service.assignValidators(job.id, ['v1']);

    expect(assigned.commitDeadline!.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(assigned.commitDeadline!.getTime()).toBeLessThan(before + 120_000);
    expect(assigned.revealDeadline!.getTime() - assigned.commitDeadline!.getTime()).toBe(30_000);
  });

  it('stamps the completion time on terminal statuses only', async () => {
    const { service } = build();
    const job = await service.submit(dto);

    expect((await service.updateStatus(job.id, JobStatus.IN_PROGRESS)).completedAt).toBeUndefined();
    expect((await service.updateStatus(job.id, JobStatus.FAILED)).completedAt).toBeInstanceOf(Date);
  });

  it('filters the listing by status', async () => {
    const { service } = build();
    const first = await service.submit(dto);
    await service.submit({ ...dto, sessionId: 'c2b7a1f4-3d5e-4a6b-8c9d-0e1f2a3b4c5d' });
    await service.updateStatus(first.id, JobStatus.COMPLETED);

    expect(await service.findAll()).toHaveLength(2);
    expect(await service.findAll(JobStatus.COMPLETED)).toEqual([expect.objectContaining({ id: first.id })]);
    expect(await service.findBySessionId(dto.sessionId)).toMatchObject({ id: first.id });
  });

  it('reports an unknown job as not found', async () => {
    const { service } = build();

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
