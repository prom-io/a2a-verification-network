import { StakingTier } from '../validators/staking-tiers';
import { parseMinScore, scoreCandidates } from './reputation-gate';

const candidate = (id: string) => ({ id, tier: StakingTier.BRONZE, weight: 1 });

describe('parseMinScore', () => {
  it('reads the stored decimal and treats anything unusable as no gate', () => {
    expect(parseMinScore('0.7500')).toBe(0.75);
    expect(parseMinScore(0.6)).toBe(0.6);
    expect(parseMinScore('0.0000')).toBe(0);
    expect(parseMinScore(null)).toBe(0);
    expect(parseMinScore(undefined)).toBe(0);
    expect(parseMinScore('abc')).toBe(0);
    expect(parseMinScore('-0.2')).toBe(0);
    expect(parseMinScore('1.5')).toBe(1);
  });
});

describe('scoreCandidates', () => {
  it('admits validators at or above the minimum', () => {
    const scored = scoreCandidates(
      [candidate('high'), candidate('exact'), candidate('low')],
      new Map([
        ['high', 0.91],
        ['exact', 0.8],
        ['low', 0.7999],
      ]),
      0.8,
      0.5,
    );

    expect(scored.map(({ id, score, qualifies }) => ({ id, score, qualifies }))).toEqual([
      { id: 'high', score: 0.91, qualifies: true },
      { id: 'exact', score: 0.8, qualifies: true },
      { id: 'low', score: 0.7999, qualifies: false },
    ]);
  });

  it('is not tripped by floating-point noise on the boundary', () => {
    const [scored] = scoreCandidates([candidate('v')], new Map([['v', 0.1 + 0.2]]), 0.3, 0.5);

    expect(scored.qualifies).toBe(true);
  });

  it('scores unrated validators at the neutral score', () => {
    const scored = scoreCandidates([candidate('new')], new Map(), 0.5, 0.5);
    const strict = scoreCandidates([candidate('new')], new Map(), 0.6, 0.5);

    expect(scored[0]).toMatchObject({ score: 0.5, qualifies: true });
    expect(strict[0]).toMatchObject({ score: 0.5, qualifies: false });
  });

  it('keeps the candidate fields for the committee draw', () => {
    const [scored] = scoreCandidates(
      [{ id: 'v', tier: StakingTier.GOLD, weight: 4, stake: '42' }],
      new Map([['v', 1]]),
      0,
      0.5,
    );

    expect(scored).toEqual({ id: 'v', tier: StakingTier.GOLD, weight: 4, stake: '42', score: 1, qualifies: true });
  });
});
