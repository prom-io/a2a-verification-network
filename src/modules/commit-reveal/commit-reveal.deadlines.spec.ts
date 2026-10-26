import { ConflictException, NotFoundException } from '@nestjs/common';
import { JobStatus } from '../jobs/entities/verification-job.entity';
import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import { COMMIT_DEADLINE, REVEAL_DEADLINE, at, buildRound } from './testing/round.fixture';

// The fixture opens the round at T0 with five minutes per phase:
// commit closes at +300s, reveal at +600s.
const DURING_COMMIT = at(10);
const AFTER_COMMIT = at(301);
const AFTER_REVEAL = at(601);

describe('CommitRevealService phases and deadlines', () => {
  it('reports the phase as the clock and the commitments move on', async () => {
    const { service, validators, commit } = buildRound(2);

    expect((await service.status('job-1', DURING_COMMIT)).phase).toBe('commit');
    expect((await service.status('job-1', AFTER_COMMIT)).phase).toBe('reveal');

    await commit(validators[0], VerdictOutcome.ACCEPT);
    expect((await service.status('job-1', DURING_COMMIT)).phase).toBe('commit');
    await commit(validators[1], VerdictOutcome.ACCEPT);
    // Everyone has committed: no reason to wait for the deadline.
    expect((await service.status('job-1', DURING_COMMIT)).phase).toBe('reveal');
  });

  it('exposes the committee and both deadlines', async () => {
    const { service, validators } = buildRound(3);

    const round = await service.status('job-1', DURING_COMMIT);

    expect(round.committee).toEqual(validators.map((v) => v.id));
    expect(round.commitDeadline).toEqual(COMMIT_DEADLINE);
    expect(round.revealDeadline).toEqual(REVEAL_DEADLINE);
    expect(round.jobStatus).toBe(JobStatus.IN_PROGRESS);
  });

  it('refuses a commitment after the commit deadline', async () => {
    const { validators, commit, rows } = buildRound(3);

    await expect(commit(validators[0], VerdictOutcome.ACCEPT, AFTER_COMMIT)).rejects.toThrow(
      'Commit phase is closed',
    );
    expect(rows).toHaveLength(0);
  });

  it('accepts a commitment exactly at the deadline', async () => {
    const { validators, commit } = buildRound(3);

    await expect(commit(validators[0], VerdictOutcome.ACCEPT, COMMIT_DEADLINE)).resolves.toMatchObject({
      revealed: false,
    });
  });

  it('opens the reveal phase at the deadline even if a validator never committed', async () => {
    const { validators, commit, reveal, verdicts, job } = buildRound(3);
    const [a, b] = validators;
    await commit(a, VerdictOutcome.REJECT);
    await commit(b, VerdictOutcome.REJECT);

    await reveal(a, VerdictOutcome.REJECT, AFTER_COMMIT);
    const round = await reveal(b, VerdictOutcome.REJECT, AFTER_COMMIT);

    // Two of three is still a majority of the committee.
    expect(round.phase).toBe('finalized');
    expect(verdicts.createAndPublish).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: VerdictOutcome.REJECT, validatorIds: [a.id, b.id] }),
    );
    expect(job.status).toBe(JobStatus.COMPLETED);
  });

  it('does not let a validator without a commitment reveal', async () => {
    const { validators, commit, reveal } = buildRound(3);
    await commit(validators[0], VerdictOutcome.ACCEPT);

    await expect(reveal(validators[2], VerdictOutcome.ACCEPT, AFTER_COMMIT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a reveal after the reveal deadline', async () => {
    const { validators, commit, reveal, rows } = buildRound(2);
    await commit(validators[0], VerdictOutcome.ACCEPT);
    await commit(validators[1], VerdictOutcome.ACCEPT);

    await expect(reveal(validators[0], VerdictOutcome.ACCEPT, AFTER_REVEAL)).rejects.toThrow(
      'Reveal phase is closed',
    );
    expect(rows.every((row) => row.revealedAt === null)).toBe(true);
  });

  it('refuses a second reveal from the same validator', async () => {
    const { validators, commit, reveal } = buildRound(2);
    await commit(validators[0], VerdictOutcome.ACCEPT);
    await commit(validators[1], VerdictOutcome.ACCEPT);
    await reveal(validators[0], VerdictOutcome.ACCEPT);

    await expect(reveal(validators[0], VerdictOutcome.ACCEPT)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('CommitRevealService.finalize', () => {
  it('cannot close a round that is still collecting commitments', async () => {
    const { service } = buildRound(3);

    await expect(service.finalize('job-1', DURING_COMMIT)).rejects.toThrow(
      'Commit phase is still open',
    );
  });

  it('cannot close a round while validators may still reveal', async () => {
    const { service, validators, commit, reveal, job } = buildRound(3);
    for (const validator of validators) await commit(validator, VerdictOutcome.ACCEPT);
    await reveal(validators[0], VerdictOutcome.ACCEPT);
    await reveal(validators[1], VerdictOutcome.ACCEPT);

    // A majority has already revealed, but the third vote is still due and
    // belongs in the record.
    await expect(service.finalize('job-1', at(30))).rejects.toThrow('Reveal phase is still open');
    expect(job.status).toBe(JobStatus.IN_PROGRESS);
  });

  it('settles with the revealed votes once the reveal deadline has passed', async () => {
    const { service, validators, commit, reveal, verdicts } = buildRound(3);
    const [a, b, c] = validators;
    for (const validator of validators) await commit(validator, VerdictOutcome.PARTIAL);
    await reveal(a, VerdictOutcome.PARTIAL);
    await reveal(b, VerdictOutcome.PARTIAL);

    const round = await service.finalize('job-1', AFTER_REVEAL);

    expect(round.phase).toBe('finalized');
    expect(round.jobStatus).toBe(JobStatus.COMPLETED);
    expect(round.commitments.find((v) => v.validatorId === c.id)).toMatchObject({ revealed: false });
    expect(verdicts.createAndPublish).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: VerdictOutcome.PARTIAL, validatorIds: [a.id, b.id] }),
    );
  });

  it('fails the job when too few validators revealed', async () => {
    const { service, validators, commit, reveal, verdicts, job } = buildRound(3);
    for (const validator of validators) await commit(validator, VerdictOutcome.ACCEPT);
    await reveal(validators[0], VerdictOutcome.ACCEPT);

    const round = await service.finalize('job-1', AFTER_REVEAL);

    expect(round.tally.outcome).toBeNull();
    expect(round.tally.quorum).toBe(2);
    expect(verdicts.createAndPublish).not.toHaveBeenCalled();
    expect(job.status).toBe(JobStatus.FAILED);
  });

  it('fails the job when the committee splits evenly', async () => {
    const { validators, commit, reveal, verdicts, job } = buildRound(2);
    await commit(validators[0], VerdictOutcome.ACCEPT);
    await commit(validators[1], VerdictOutcome.REJECT);
    await reveal(validators[0], VerdictOutcome.ACCEPT);

    const round = await reveal(validators[1], VerdictOutcome.REJECT);

    expect(round.phase).toBe('finalized');
    expect(verdicts.createAndPublish).not.toHaveBeenCalled();
    expect(job.status).toBe(JobStatus.FAILED);
  });

  it('fails a round nobody took part in', async () => {
    const { service, verdicts, job } = buildRound(3);

    const round = await service.finalize('job-1', AFTER_REVEAL);

    expect(round.commitments).toEqual([]);
    expect(verdicts.createAndPublish).not.toHaveBeenCalled();
    expect(job.status).toBe(JobStatus.FAILED);
  });

  it('is idempotent once the round is finalized', async () => {
    const { service, validators, commit, reveal, verdicts } = buildRound(1);
    await commit(validators[0], VerdictOutcome.ACCEPT);
    await reveal(validators[0], VerdictOutcome.ACCEPT);

    const first = await service.finalize('job-1', AFTER_REVEAL);
    const second = await service.finalize('job-1', AFTER_REVEAL);

    expect(first.phase).toBe('finalized');
    expect(second).toEqual(first);
    expect(verdicts.createAndPublish).toHaveBeenCalledTimes(1);
  });

  it('rejects late commitments and reveals on a finalized round', async () => {
    const { validators, commit, reveal } = buildRound(1);
    await commit(validators[0], VerdictOutcome.ACCEPT);
    await reveal(validators[0], VerdictOutcome.ACCEPT);

    await expect(commit(validators[0], VerdictOutcome.ACCEPT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(reveal(validators[0], VerdictOutcome.ACCEPT)).rejects.toThrow('already finalized');
  });

  it('reports an unknown job as not found', async () => {
    const { service } = buildRound(1);

    await expect(service.finalize('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
