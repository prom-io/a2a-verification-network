import { createHash } from 'crypto';

export enum StakingTier {
  NONE = 'none',
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
}

export interface TierDefinition {
  tier: StakingTier;
  /** Smallest stake, in wei, that qualifies for the tier. */
  minStakeWei: bigint;
  /** Relative chance of being picked for a job committee. */
  weight: number;
}

/**
 * Tier thresholds as multiples of the minimum stake. Weights grow much slower
 * than the stake that buys them (100x the stake for 8x the weight): a larger
 * stake is rewarded, but one whale cannot crowd everybody else out of the
 * committees.
 */
const TIER_STEPS: ReadonlyArray<{ tier: StakingTier; multiple: bigint; weight: number }> = [
  { tier: StakingTier.BRONZE, multiple: 1n, weight: 1 },
  { tier: StakingTier.SILVER, multiple: 5n, weight: 2 },
  { tier: StakingTier.GOLD, multiple: 20n, weight: 4 },
  { tier: StakingTier.PLATINUM, multiple: 100n, weight: 8 },
];

const UNSTAKED: TierDefinition = { tier: StakingTier.NONE, minStakeWei: 0n, weight: 0 };

/** Tier table for a given minimum stake, ordered from the lowest tier up. */
export function buildTierTable(minStakeWei: bigint): TierDefinition[] {
  if (minStakeWei <= 0n) throw new Error('minimum stake must be positive');
  return TIER_STEPS.map(({ tier, multiple, weight }) => ({
    tier,
    minStakeWei: minStakeWei * multiple,
    weight,
  }));
}

/**
 * Parses a stake as stored or submitted. The column is numeric, so values come
 * back as decimal strings; anything fractional or malformed counts as no stake
 * rather than throwing inside committee selection.
 */
export function parseStake(stake: string | bigint | null | undefined): bigint {
  if (typeof stake === 'bigint') return stake < 0n ? 0n : stake;
  if (!stake) return 0n;
  const integerPart = String(stake).trim().split('.')[0];
  return /^\d+$/.test(integerPart) ? BigInt(integerPart) : 0n;
}

/** Highest tier the stake qualifies for; below the minimum there is none. */
export function tierForStake(stakeWei: bigint, table: TierDefinition[]): TierDefinition {
  let matched = UNSTAKED;
  for (const definition of table) {
    if (stakeWei >= definition.minStakeWei) matched = definition;
  }
  return matched;
}

export interface WeightedCandidate {
  id: string;
  weight: number;
}

/**
 * Uniform number in (0, 1) derived from the seed and the candidate id. Hashing
 * instead of Math.random makes the committee for a job reproducible: anyone
 * holding the validator set can recompute who should have been assigned.
 */
function unitInterval(seed: string, id: string): number {
  const digest = createHash('sha256').update(`${seed}:${id}`).digest();
  const value = digest.readUIntBE(0, 6); // 48 bits, exact in a double
  return (value + 1) / (2 ** 48 + 1);
}

/**
 * Weighted sampling without replacement (Efraimidis-Spirakis): every candidate
 * draws the key -ln(u) / weight and the smallest keys win. A candidate with
 * twice the weight is twice as likely to be drawn first, and nobody can be
 * picked twice. Candidates with no weight are never selected.
 */
export function selectWeighted(
  candidates: WeightedCandidate[],
  count: number,
  seed: string,
): string[] {
  if (count <= 0) return [];
  return candidates
    .filter((candidate) => candidate.weight > 0)
    .map((candidate) => ({
      id: candidate.id,
      key: -Math.log(unitInterval(seed, candidate.id)) / candidate.weight,
    }))
    .sort((a, b) => a.key - b.key || a.id.localeCompare(b.id))
    .slice(0, count)
    .map((entry) => entry.id);
}
