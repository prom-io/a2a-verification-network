import { JobStatus } from '../jobs/entities/verification-job.entity';
import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import { QuorumWeighting } from './weighted-quorum';
import { at, buildRound } from './testing/round.fixture';

const ETHER = 10n ** 18n;
const eth = (n: number) => (BigInt(n) * ETHER).toString();

/** A committee of three where the first member holds most of the stake. */
function whaleRound(weighting: QuorumWeighting, thresholdBps = 5001) {
  const round = buildRound(3, { quorumWeighting: weighting, quorumThresholdBps: thresholdBps });
  const [whale, small1, small2] = round.validators;
  round.job.committeeWeights = { [whale.id]: eth(10), [small1.id]: eth(1), [small2.id]: eth(1) };
  return { ...round, whale, small1, small2 };
}

describe('CommitRevealService stake-weighted quorum', () => {
  it('decides by stake when the job votes stake-weighted', async () => {
    const { commit, reveal, verdicts, whale, small1, small2 } = whaleRound(QuorumWeighting.STAKE);
    await commit(whale, VerdictOutcome.ACCEPT);
    await commit(small1, VerdictOutcome.REJECT);
    await commit(small2, VerdictOutcome.REJECT);
    await reveal(whale, VerdictOutcome.ACCEPT);
    await reveal(small1, VerdictOutcome.REJECT);

    const round = await reveal(small2, VerdictOutcome.REJECT);

    expect(round.tally.outcome).toBe(VerdictOutcome.ACCEPT);
    expect(round.tally.counts).toEqual({ accept: 1, partial: 0, reject: 2 });
    expect(round.tally.weighted).toMatchObject({
      weighting: QuorumWeighting.STAKE,
      totalWeight: eth(12),
      weights: { accept: eth(10), reject: eth(2) },
    });
    expect(verdicts.createAndPublish).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: VerdictOutcome.ACCEPT, validatorIds: [whale.id] }),
    );
  });

  it('counts heads for the same votes under equal weighting', async () => {
    const { commit, reveal, whale, small1, small2 } = whaleRound(QuorumWeighting.EQUAL);
    await commit(whale, VerdictOutcome.ACCEPT);
    await commit(small1, VerdictOutcome.REJECT);
    await commit(small2, VerdictOutcome.REJECT);
    await reveal(whale, VerdictOutcome.ACCEPT);
    await reveal(small1, VerdictOutcome.REJECT);

    const round = await reveal(small2, VerdictOutcome.REJECT);

    expect(round.tally.outcome).toBe(VerdictOutcome.REJECT);
    expect(round.tally.supporters).toEqual([small1.id, small2.id]);
  });

  it.each([
    [9000, VerdictOutcome.ACCEPT, JobStatus.COMPLETED],
    [9500, null, JobStatus.FAILED],
  ])('with a threshold of %i bps, 11 of 12 ether decides %p', async (bps, outcome, status) => {
    const { commit, reveal, job, whale, small1, small2 } = whaleRound(QuorumWeighting.STAKE, bps);
    await commit(whale, VerdictOutcome.ACCEPT);
    await commit(small1, VerdictOutcome.REJECT);
    await commit(small2, VerdictOutcome.ACCEPT);
    await reveal(whale, VerdictOutcome.ACCEPT);
    await reveal(small2, VerdictOutcome.ACCEPT);

    const round = await reveal(small1, VerdictOutcome.REJECT);

    expect(round.tally.outcome).toBe(outcome);
    expect(job.status).toBe(status);
  });

  it('keeps a silent whale in the denominator', async () => {
    const { commit, reveal, service, job, small1, small2, whale } = whaleRound(QuorumWeighting.STAKE);
    await commit(whale, VerdictOutcome.ACCEPT);
    await commit(small1, VerdictOutcome.REJECT);
    await commit(small2, VerdictOutcome.REJECT);
    await reveal(small1, VerdictOutcome.REJECT);
    await reveal(small2, VerdictOutcome.REJECT);

    const round = await service.finalize(job.id, at(700));

    expect(round.tally.outcome).toBeNull();
    expect(round.tally.weighted.requiredWeight).toBe((6_001_200_000_000_000_000n).toString());
    expect(job.status).toBe(JobStatus.FAILED);
  });

  it('treats jobs without recorded rules as one vote per validator', async () => {
    const { commit, reveal, validators } = buildRound(3);
    const [a, b, c] = validators;
    await commit(a, VerdictOutcome.ACCEPT);
    await commit(b, VerdictOutcome.REJECT);
    await commit(c, VerdictOutcome.REJECT);
    await reveal(a, VerdictOutcome.ACCEPT);
    await reveal(b, VerdictOutcome.REJECT);

    const round = await reveal(c, VerdictOutcome.REJECT);

    expect(round.tally.weighted.weighting).toBe(QuorumWeighting.EQUAL);
    expect(round.tally.outcome).toBe(VerdictOutcome.REJECT);
    expect(round.tally.quorum).toBe(2);
  });
});
