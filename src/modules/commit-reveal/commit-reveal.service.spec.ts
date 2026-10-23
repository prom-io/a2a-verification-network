import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ethers } from 'ethers';
import { JobStatus, VerdictMode } from '../jobs/entities/verification-job.entity';
import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import { at, buildRound, saltFor } from './testing/round.fixture';

describe('CommitRevealService', () => {
  it('publishes the majority verdict once every commitment is revealed', async () => {
    const { validators, commit, reveal, verdicts, jobs, job } = buildRound(3);
    const [a, b, c] = validators;

    await commit(a, VerdictOutcome.ACCEPT);
    await commit(b, VerdictOutcome.ACCEPT);
    await commit(c, VerdictOutcome.REJECT);

    await reveal(a, VerdictOutcome.ACCEPT);
    await reveal(b, VerdictOutcome.ACCEPT);
    expect(verdicts.createAndPublish).not.toHaveBeenCalled();

    const round = await reveal(c, VerdictOutcome.REJECT);

    expect(verdicts.createAndPublish).toHaveBeenCalledTimes(1);
    expect(verdicts.createAndPublish).toHaveBeenCalledWith({
      sessionId: 'session-1',
      jobId: 'job-1',
      outcome: VerdictOutcome.ACCEPT,
      payableAmount: '0',
      metaHash: '0xresult',
      validatorIds: [a.id, b.id],
    });
    expect(jobs.updateStatus).toHaveBeenCalledWith('job-1', JobStatus.COMPLETED);
    expect(job.status).toBe(JobStatus.COMPLETED);
    expect(round.phase).toBe('finalized');
    expect(round.tally.outcome).toBe(VerdictOutcome.ACCEPT);
  });

  it('keeps the vote hidden until the reveal', async () => {
    const { validators, commit, service } = buildRound(3);

    const view = await commit(validators[0], VerdictOutcome.REJECT);
    const round = await service.status('job-1', at(11));

    expect(view).toMatchObject({ validatorId: validators[0].id, revealed: false, outcome: null });
    expect(round.phase).toBe('commit');
    expect(round.commitments).toHaveLength(1);
    expect(JSON.stringify(round)).not.toContain(saltFor(validators[0].id));
    expect(round.tally.counts).toEqual({ accept: 0, partial: 0, reject: 0 });
  });

  it('refuses a reveal while other validators can still commit', async () => {
    const { validators, commit, reveal, rows } = buildRound(3);
    await commit(validators[0], VerdictOutcome.ACCEPT);

    await expect(reveal(validators[0], VerdictOutcome.ACCEPT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(rows[0].revealedAt).toBeNull();
  });

  it('rejects a reveal that does not match the commitment', async () => {
    const { validators, commit, reveal, service, job } = buildRound(1);
    await commit(validators[0], VerdictOutcome.ACCEPT);

    // Committed to accept, tries to switch to reject after seeing the others.
    await expect(reveal(validators[0], VerdictOutcome.REJECT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Right outcome, wrong salt.
    await expect(
      service.reveal(
        job.id,
        { validatorId: validators[0].id, outcome: VerdictOutcome.ACCEPT, salt: ethers.id('guess') },
        at(20),
      ),
    ).rejects.toThrow('Reveal does not match the commitment');
    expect(job.status).toBe(JobStatus.IN_PROGRESS);
  });

  it('rejects a commitment from a validator outside the committee', async () => {
    const { service, job, commitPayload } = buildRound(2);
    const outsider = {
      id: '00000000-0000-4000-8000-0000000000ff',
      wallet: ethers.Wallet.createRandom(),
    };

    await expect(
      service.commit(job.id, await commitPayload(outsider, VerdictOutcome.ACCEPT), at(10)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a commitment signed by a key other than the validator address', async () => {
    const { service, job, validators, commitPayload, rows } = buildRound(2);
    const impostor = ethers.Wallet.createRandom();

    await expect(
      service.commit(
        job.id,
        await commitPayload(validators[0], VerdictOutcome.ACCEPT, impostor),
        at(10),
      ),
    ).rejects.toThrow('Commitment is not signed by the validator address');
    expect(rows).toHaveLength(0);
  });

  it('rejects a malformed signature', async () => {
    const { service, job, validators, commitPayload } = buildRound(2);
    const payload = await commitPayload(validators[0], VerdictOutcome.ACCEPT);

    await expect(
      service.commit(job.id, { ...payload, signature: `0x${'00'.repeat(65)}` }, at(10)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts only one commitment per validator', async () => {
    const { validators, commit } = buildRound(3);
    await commit(validators[0], VerdictOutcome.ACCEPT);

    await expect(commit(validators[0], VerdictOutcome.REJECT)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses jobs that do not use commit-reveal', async () => {
    const { service } = buildRound(3, { verdictMode: VerdictMode.INSTANT });

    await expect(service.status('job-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
