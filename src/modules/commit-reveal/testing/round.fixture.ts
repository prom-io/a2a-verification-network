import { NotFoundException } from '@nestjs/common';
import { ethers } from 'ethers';
import { Repository } from 'typeorm';
import { JobsService } from '../../jobs/jobs.service';
import {
  JobStatus,
  VerdictMode,
  VerificationJob,
} from '../../jobs/entities/verification-job.entity';
import { ValidatorsService } from '../../validators/validators.service';
import { VerdictsService } from '../../verdicts/verdicts.service';
import { VerdictOutcome } from '../../verdicts/entities/verdict.entity';
import { ReputationService } from '../../reputation/reputation.service';
import { CommitRevealService } from '../commit-reveal.service';
import { computeCommitHash } from '../commitment';
import { VerdictCommitment } from '../entities/verdict-commitment.entity';

/** A committee member with the key it signs commitments with. */
export interface TestValidator {
  id: string;
  wallet: ethers.HDNodeWallet;
}

export const T0 = new Date('2026-01-01T00:00:00.000Z');
export const COMMIT_DEADLINE = new Date(T0.getTime() + 300_000);
export const REVEAL_DEADLINE = new Date(T0.getTime() + 600_000);

export const at = (secondsAfterStart: number) => new Date(T0.getTime() + secondsAfterStart * 1000);

export function saltFor(label: string): string {
  return ethers.id(`salt:${label}`);
}

/**
 * In-memory commit-reveal round: a job with a committee of freshly generated
 * validators, and stubs standing in for the job, validator and verdict
 * services. Only the commitment logic under test is real.
 */
export function buildRound(committeeSize = 3, overrides: Partial<VerificationJob> = {}) {
  const validators: TestValidator[] = Array.from({ length: committeeSize }, (_, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i + 1}`,
    wallet: ethers.Wallet.createRandom(),
  }));

  const job = {
    id: 'job-1',
    sessionId: 'session-1',
    requestHash: '0xrequest',
    resultHash: '0xresult',
    status: JobStatus.IN_PROGRESS,
    verdictMode: VerdictMode.COMMIT_REVEAL,
    assignedValidators: validators.map((v) => v.id),
    commitDeadline: COMMIT_DEADLINE,
    revealDeadline: REVEAL_DEADLINE,
    ...overrides,
  } as VerificationJob;

  const rows: VerdictCommitment[] = [];
  const commitmentRepo = {
    create: jest.fn((data: Partial<VerdictCommitment>) => ({ ...data }) as VerdictCommitment),
    save: jest.fn(async (entity: VerdictCommitment) => {
      if (!rows.includes(entity)) {
        entity.id = `commitment-${rows.length + 1}`;
        entity.committedAt = new Date(T0.getTime() + rows.length);
        rows.push(entity);
      }
      return entity;
    }),
    find: jest.fn(async () => [...rows]),
  };

  const jobs = {
    findOne: jest.fn(async (id: string) => {
      if (id !== job.id) throw new NotFoundException(`Job ${id} not found`);
      return job;
    }),
    updateStatus: jest.fn(async (_id: string, status: JobStatus) => {
      job.status = status;
      return job;
    }),
  };

  const validatorsService = {
    findOne: jest.fn(async (id: string) => {
      const validator = validators.find((v) => v.id === id);
      if (!validator) throw new NotFoundException(`Validator ${id} not found`);
      return { id, address: validator.wallet.address };
    }),
  };

  const verdicts = {
    createAndPublish: jest.fn(async (params: { outcome: VerdictOutcome }) => ({
      id: 'verdict-1',
      ...params,
    })),
  };

  const reputation = { recordForValidators: jest.fn(async () => undefined) };

  const service = new CommitRevealService(
    commitmentRepo as unknown as Repository<VerdictCommitment>,
    jobs as unknown as JobsService,
    validatorsService as unknown as ValidatorsService,
    verdicts as unknown as VerdictsService,
    reputation as unknown as ReputationService,
  );

  /** Builds the commit payload a validator node would send. */
  const commitPayload = async (
    validator: TestValidator,
    outcome: VerdictOutcome,
    signer: ethers.HDNodeWallet = validator.wallet,
  ) => {
    const commitHash = computeCommitHash(job.id, validator.id, outcome, saltFor(validator.id));
    const signature = await signer.signMessage(ethers.getBytes(commitHash));
    return { validatorId: validator.id, commitHash, signature };
  };

  const commit = async (validator: TestValidator, outcome: VerdictOutcome, now = at(10)) =>
    service.commit(job.id, await commitPayload(validator, outcome), now);

  const reveal = (validator: TestValidator, outcome: VerdictOutcome, now = at(20)) =>
    service.reveal(
      job.id,
      { validatorId: validator.id, outcome, salt: saltFor(validator.id) },
      now,
    );

  return {
    service,
    job,
    validators,
    rows,
    jobs,
    verdicts,
    reputation,
    commitPayload,
    commit,
    reveal,
  };
}
