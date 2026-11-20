import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import {
  QuorumRules,
  QuorumWeighting,
  isValidThreshold,
  memberWeights,
  requiredWeight,
  tallyWeighted,
} from './weighted-quorum';

const { ACCEPT, PARTIAL, REJECT } = VerdictOutcome;
const ETHER = 10n ** 18n;
const eth = (n: number) => (BigInt(n) * ETHER).toString();

const stakeRules = (weights: Record<string, string>, thresholdBps = 5001): QuorumRules => ({
  weighting: QuorumWeighting.STAKE,
  thresholdBps,
  weights,
});

describe('requiredWeight', () => {
  it('is the threshold share of the total, rounded up', () => {
    expect(requiredWeight(3n, 5001)).toBe(2n);
    expect(requiredWeight(4n, 5001)).toBe(3n);
    expect(requiredWeight(5n, 6667)).toBe(4n);
    expect(requiredWeight(3n, 10_000)).toBe(3n);
    expect(requiredWeight(12n * ETHER, 5001)).toBe(6_001_200_000_000_000_000n);
  });

  it('never asks for less than one unit', () => {
    expect(requiredWeight(0n, 5001)).toBe(1n);
    expect(requiredWeight(1n, 5001)).toBe(1n);
  });
});

describe('isValidThreshold', () => {
  it('accepts strict majorities up to unanimity only', () => {
    expect(isValidThreshold(5001)).toBe(true);
    expect(isValidThreshold(10_000)).toBe(true);
    expect(isValidThreshold(5000)).toBe(false);
    expect(isValidThreshold(10_001)).toBe(false);
    expect(isValidThreshold(6666.5)).toBe(false);
  });
});

describe('memberWeights', () => {
  it('uses the recorded stakes and gives unrecorded members no weight', () => {
    const weights = memberWeights(['a', 'b', 'c'], stakeRules({ a: eth(5), b: eth(1) }));

    expect([...weights]).toEqual([
      ['a', 5n * ETHER],
      ['b', ETHER],
      ['c', 0n],
    ]);
  });

  it('falls back to one vote each when no stake was recorded', () => {
    expect([...memberWeights(['a', 'b'], stakeRules({}))]).toEqual([
      ['a', 1n],
      ['b', 1n],
    ]);
  });

  it('ignores stakes under equal weighting and counts a seat once', () => {
    const rules = { ...stakeRules({ a: eth(100) }), weighting: QuorumWeighting.EQUAL };

    expect([...memberWeights(['a', 'b', 'a'], rules)]).toEqual([
      ['a', 1n],
      ['b', 1n],
    ]);
  });
});

describe('tallyWeighted', () => {
  const committee = ['whale', 'small-1', 'small-2'];
  const weights = { whale: eth(10), 'small-1': eth(1), 'small-2': eth(1) };

  it('lets the larger stake carry the round under stake weighting', () => {
    const tally = tallyWeighted(
      [
        { validatorId: 'whale', outcome: ACCEPT },
        { validatorId: 'small-1', outcome: REJECT },
        { validatorId: 'small-2', outcome: REJECT },
      ],
      committee,
      stakeRules(weights),
    );

    expect(tally).toMatchObject({
      outcome: ACCEPT,
      supporters: ['whale'],
      weighting: QuorumWeighting.STAKE,
      totalWeight: eth(12),
      weights: { accept: eth(10), partial: '0', reject: eth(2) },
    });
  });

  it('counts heads under equal weighting', () => {
    const tally = tallyWeighted(
      [
        { validatorId: 'whale', outcome: ACCEPT },
        { validatorId: 'small-1', outcome: REJECT },
        { validatorId: 'small-2', outcome: REJECT },
      ],
      committee,
      { ...stakeRules(weights), weighting: QuorumWeighting.EQUAL },
    );

    expect(tally.outcome).toBe(REJECT);
    expect(tally.supporters).toEqual(['small-1', 'small-2']);
    expect(tally.requiredWeight).toBe('2');
  });

  it('raises the bar with the threshold', () => {
    const votes = [
      { validatorId: 'whale', outcome: ACCEPT },
      { validatorId: 'small-1', outcome: ACCEPT },
    ];

    // 11 of 12 ether is 91.7%: enough for a two-thirds quorum, not for 95%.
    expect(tallyWeighted(votes, committee, stakeRules(weights, 6667)).outcome).toBe(ACCEPT);
    expect(tallyWeighted(votes, committee, stakeRules(weights, 9500)).outcome).toBeNull();
  });

  it('keeps silent members in the denominator', () => {
    const tally = tallyWeighted(
      [{ validatorId: 'small-1', outcome: PARTIAL }],
      committee,
      stakeRules(weights),
    );

    expect(tally.outcome).toBeNull();
    expect(tally.supporters).toEqual([]);
    expect(tally.weights.partial).toBe(eth(1));
  });

  it('gives votes from outside the committee and repeated votes no weight', () => {
    const tally = tallyWeighted(
      [
        { validatorId: 'small-1', outcome: REJECT },
        { validatorId: 'small-1', outcome: REJECT },
        { validatorId: 'small-1', outcome: ACCEPT },
        { validatorId: 'outsider', outcome: REJECT },
      ],
      committee,
      stakeRules({ ...weights, outsider: eth(1000) }),
    );

    expect(tally.weights.reject).toBe(eth(1));
    expect(tally.weights.accept).toBe('0');
    expect(tally.outcome).toBeNull();
  });

  it('can be decided by a committee whose stakes were never recorded', () => {
    const tally = tallyWeighted(
      [
        { validatorId: 'a', outcome: ACCEPT },
        { validatorId: 'b', outcome: ACCEPT },
      ],
      ['a', 'b', 'c'],
      stakeRules({}),
    );

    expect(tally.outcome).toBe(ACCEPT);
    expect(tally.totalWeight).toBe('3');
  });
});
