import {
  StakingTier,
  buildTierTable,
  parseStake,
  selectWeighted,
  tierForStake,
} from './staking-tiers';

const ETHER = 10n ** 18n;

describe('staking tiers', () => {
  const table = buildTierTable(ETHER);

  it('builds thresholds as multiples of the minimum stake', () => {
    expect(table.map((t) => [t.tier, t.minStakeWei, t.weight])).toEqual([
      [StakingTier.BRONZE, ETHER, 1],
      [StakingTier.SILVER, 5n * ETHER, 2],
      [StakingTier.GOLD, 20n * ETHER, 4],
      [StakingTier.PLATINUM, 100n * ETHER, 8],
    ]);
  });

  it('rejects a non-positive minimum stake', () => {
    expect(() => buildTierTable(0n)).toThrow('minimum stake must be positive');
  });

  it.each([
    [0n, StakingTier.NONE, 0],
    [ETHER - 1n, StakingTier.NONE, 0],
    [ETHER, StakingTier.BRONZE, 1],
    [5n * ETHER - 1n, StakingTier.BRONZE, 1],
    [5n * ETHER, StakingTier.SILVER, 2],
    [20n * ETHER, StakingTier.GOLD, 4],
    [99n * ETHER, StakingTier.GOLD, 4],
    [100n * ETHER, StakingTier.PLATINUM, 8],
    [10_000n * ETHER, StakingTier.PLATINUM, 8],
  ])('maps a stake of %s wei to %s', (stake, tier, weight) => {
    const matched = tierForStake(stake, table);
    expect(matched.tier).toBe(tier);
    expect(matched.weight).toBe(weight);
  });

  it('parses stakes as they come back from a numeric column', () => {
    expect(parseStake('1000000000000000000')).toBe(ETHER);
    expect(parseStake('1000.000000000000000000')).toBe(1000n);
    expect(parseStake(7n)).toBe(7n);
    expect(parseStake(undefined)).toBe(0n);
    expect(parseStake('not-a-number')).toBe(0n);
    expect(parseStake('-5')).toBe(0n);
  });
});

describe('selectWeighted', () => {
  const candidates = [
    { id: 'a', weight: 1 },
    { id: 'b', weight: 2 },
    { id: 'c', weight: 4 },
    { id: 'd', weight: 8 },
  ];

  it('is deterministic for the same seed', () => {
    expect(selectWeighted(candidates, 3, 'job-1')).toEqual(selectWeighted(candidates, 3, 'job-1'));
  });

  it('does not depend on the order the candidates arrive in', () => {
    const reversed = [...candidates].reverse();
    expect(selectWeighted(reversed, 3, 'job-7')).toEqual(selectWeighted(candidates, 3, 'job-7'));
  });

  it('never selects the same validator twice', () => {
    for (let i = 0; i < 50; i++) {
      const selected = selectWeighted(candidates, 3, `job-${i}`);
      expect(new Set(selected).size).toBe(3);
    }
  });

  it('returns every eligible candidate when the committee is larger than the set', () => {
    expect(selectWeighted(candidates, 10, 'job-1').sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never selects a candidate without weight', () => {
    const withUnstaked = [...candidates, { id: 'unstaked', weight: 0 }];
    for (let i = 0; i < 50; i++) {
      expect(selectWeighted(withUnstaked, 5, `job-${i}`)).not.toContain('unstaked');
    }
  });

  it('returns nothing for an empty committee or an empty set', () => {
    expect(selectWeighted(candidates, 0, 'job-1')).toEqual([]);
    expect(selectWeighted([], 3, 'job-1')).toEqual([]);
  });

  it('picks heavier validators first proportionally more often', () => {
    const firstPicks: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    const rounds = 6000;
    for (let i = 0; i < rounds; i++) {
      firstPicks[selectWeighted(candidates, 1, `job-${i}`)[0]]++;
    }

    // Expected shares are weight / 15: 6.7%, 13.3%, 26.7%, 53.3%.
    expect(firstPicks.a / rounds).toBeCloseTo(1 / 15, 1);
    expect(firstPicks.b / rounds).toBeCloseTo(2 / 15, 1);
    expect(firstPicks.c / rounds).toBeCloseTo(4 / 15, 1);
    expect(firstPicks.d / rounds).toBeCloseTo(8 / 15, 1);
    expect(firstPicks.d).toBeGreaterThan(firstPicks.c);
    expect(firstPicks.c).toBeGreaterThan(firstPicks.b);
    expect(firstPicks.b).toBeGreaterThan(firstPicks.a);
  });
});
