import { ForbiddenException } from '@nestjs/common';
import { JobStatus } from '../jobs/entities/verification-job.entity';
import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import { at, buildRound } from './testing/round.fixture';

const { ACCEPT, REJECT } = VerdictOutcome;
// The fixture's first round: commit until +300s, reveal until +600s.
const TIMED_OUT = at(601);
// After a widening at +601s: commit until +901s, reveal until +1201s.
const SECOND_COMMIT = at(700);
const SECOND_REVEAL = at(950);

/**
 * A committee of three where one member commits and goes silent and another
 * never shows up: the round times out with a single revealed vote.
 */
async function timedOutRound(reserveSize = 3, settings: Record<string, unknown> = {}) {
  const round = buildRound(3, {}, settings);
  const [a, b] = round.validators;
  await round.commit(a, ACCEPT);
  await round.commit(b, ACCEPT);
  await round.reveal(a, ACCEPT, at(400));
  const added = round.addReserve(reserveSize);
  return { ...round, added };
}

describe('CommitRevealService quorum timeout fallback', () => {
  it('widens the committee instead of failing a round without a quorum', async () => {
    const { service, job, jobs, webhooks, verdicts, added, validators } = await timedOutRound();

    const round = await service.finalize(job.id, TIMED_OUT);

    expect(round.phase).toBe('commit');
    expect(round.expansions).toBe(1);
    // The original seats keep their places; the new ones follow in draw order.
    expect(round.committee.slice(0, 3)).toEqual(validators.map((v) => v.id));
    expect([...round.committee.slice(3)].sort()).toEqual(added.map((v) => v.id).sort());
    expect(job.status).toBe(JobStatus.IN_PROGRESS);
    expect(jobs.expandCommittee).toHaveBeenCalledWith(
      job.id,
      expect.arrayContaining(added.map((v) => v.id)),
      Object.fromEntries(added.map((v) => [v.id, '1000'])),
      TIMED_OUT,
    );
    expect(round.commitDeadline).toEqual(at(901));
    expect(round.revealDeadline).toEqual(at(1201));
    expect(verdicts.createAndPublish).not.toHaveBeenCalled();
    expect(webhooks.notifyJobFailed).not.toHaveBeenCalled();
  });

  it('hides earlier reveals while the new members commit', async () => {
    const { service, job } = await timedOutRound();
    await service.finalize(job.id, TIMED_OUT);

    const round = await service.status(job.id, SECOND_COMMIT);

    expect(round.commitments.every((c) => c.outcome === null)).toBe(true);
    expect(round.commitments.find((c) => c.revealed)).toBeDefined();
    expect(round.tally.counts).toEqual({ accept: 0, partial: 0, reject: 0 });
    expect(round.tally.outcome).toBeNull();
  });

  it('keeps out an original member that never committed', async () => {
    const { service, job, commit, validators } = await timedOutRound();
    await service.finalize(job.id, TIMED_OUT);

    await expect(commit(validators[2], REJECT, SECOND_COMMIT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('decides the widened round with the votes of both rounds', async () => {
    const { service, job, commit, reveal, verdicts, validators, added } = await timedOutRound();
    await service.finalize(job.id, TIMED_OUT);

    for (const member of added) await commit(member, member === added[2] ? REJECT : ACCEPT, SECOND_COMMIT);
    // Every seat that may still commit has done so: the reveal phase opens early.
    expect((await service.status(job.id, SECOND_COMMIT)).phase).toBe('reveal');

    await reveal(added[0], ACCEPT, SECOND_REVEAL);
    await reveal(added[1], ACCEPT, SECOND_REVEAL);
    await reveal(added[2], REJECT, SECOND_REVEAL);
    // The member that went silent in the first round may still open its vote.
    const round = await reveal(validators[1], ACCEPT, SECOND_REVEAL);

    // 4 of 6 accept against a quorum of 4.
    expect(round.phase).toBe('finalized');
    expect(round.tally.outcome).toBe(ACCEPT);
    expect(job.status).toBe(JobStatus.COMPLETED);
    expect(verdicts.createAndPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: ACCEPT,
        validatorIds: [validators[0].id, validators[1].id, added[0].id, added[1].id],
      }),
    );
  });

  it('fails the job once the expansions are used up', async () => {
    const { service, job, webhooks } = await timedOutRound();
    await service.finalize(job.id, TIMED_OUT);

    // Nobody shows up in the widened round either.
    const round = await service.finalize(job.id, at(1300));

    expect(round.phase).toBe('finalized');
    expect(job.status).toBe(JobStatus.FAILED);
    expect(job.quorumExpansions).toBe(1);
    expect(webhooks.notifyJobFailed).toHaveBeenCalledWith(job, 'the committee did not reach a quorum');
  });

  it('allows as many expansions as configured, of the configured size', async () => {
    const { service, job } = await timedOutRound(4, {
      'quorum.maxExpansions': 2,
      'quorum.expansionSize': 2,
    });

    await service.finalize(job.id, TIMED_OUT);
    expect(job.assignedValidators).toHaveLength(5);
    const second = await service.finalize(job.id, at(1300));

    expect(second.expansions).toBe(2);
    expect(job.assignedValidators).toHaveLength(7);
    expect(job.status).toBe(JobStatus.IN_PROGRESS);
  });

  it('fails as before when expansion is switched off or nobody is left to draw', async () => {
    const off = await timedOutRound(3, { 'quorum.maxExpansions': 0 });
    await off.service.finalize(off.job.id, TIMED_OUT);
    expect(off.job.status).toBe(JobStatus.FAILED);
    expect(off.jobs.expandCommittee).not.toHaveBeenCalled();

    const empty = await timedOutRound(0);
    await empty.service.finalize(empty.job.id, TIMED_OUT);
    expect(empty.job.status).toBe(JobStatus.FAILED);
    expect(empty.jobs.expandCommittee).not.toHaveBeenCalled();
  });

  it('draws late joiners only from the validators the policy admits', async () => {
    const { service, job, eligibility, added } = await timedOutRound(3);
    eligibility.candidatesFor.mockResolvedValue({
      minScore: 0.7,
      excluded: 2,
      candidates: [{ id: added[1].id, tier: 'bronze', weight: 1, stake: '1000' }] as never,
    });

    await service.finalize(job.id, TIMED_OUT);

    expect(job.assignedValidators.slice(3)).toEqual([added[1].id]);
  });

  it('also widens a fully revealed round whose votes are split', async () => {
    const round = buildRound(2);
    const [a, b] = round.validators;
    round.addReserve(2);
    await round.commit(a, ACCEPT);
    await round.commit(b, REJECT);
    await round.reveal(a, ACCEPT);

    const status = await round.reveal(b, REJECT);

    expect(status.phase).toBe('commit');
    expect(status.expansions).toBe(1);
    expect(round.job.assignedValidators).toHaveLength(4);
  });
});
