import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import { parseStake } from '../validators/staking-tiers';
import { RevealedVote } from './commitment';

/** How much a committee member's vote counts. */
export enum QuorumWeighting {
  /** One validator, one vote. */
  EQUAL = 'equal',
  /** Votes count with the stake the validator had when it was assigned. */
  STAKE = 'stake',
}

/**
 * Lowest accepted threshold: just over half. Anything at or below 50% would
 * let two different outcomes reach the quorum on the same committee.
 */
export const MIN_THRESHOLD_BPS = 5001;
export const MAX_THRESHOLD_BPS = 10_000;
export const DEFAULT_THRESHOLD_BPS = MIN_THRESHOLD_BPS;

export function isValidThreshold(bps: number): boolean {
  return Number.isInteger(bps) && bps >= MIN_THRESHOLD_BPS && bps <= MAX_THRESHOLD_BPS;
}

/** Weight an outcome needs: the threshold share of the total, rounded up. */
export function requiredWeight(totalWeight: bigint, thresholdBps: number): bigint {
  if (totalWeight <= 0n) return 1n;
  const required = (totalWeight * BigInt(thresholdBps) + 9_999n) / 10_000n;
  return required > 0n ? required : 1n;
}

export interface QuorumRules {
  weighting: QuorumWeighting;
  thresholdBps: number;
  /** Stake in wei per committee member, as recorded at assignment. */
  weights: Record<string, string>;
}

export interface WeightedTally {
  outcome: VerdictOutcome | null;
  supporters: string[];
  weighting: QuorumWeighting;
  thresholdBps: number;
  /** Weight behind each outcome, as decimal strings (stakes exceed 2^53). */
  weights: Record<VerdictOutcome, string>;
  totalWeight: string;
  requiredWeight: string;
}

/**
 * Weight of every committee member under the rules. Stake weighting falls
 * back to equal weights when no stake was recorded for the committee at all
 * (jobs assigned before stakes were recorded, or a committee of unstaked
 * placeholders), so such a round can still be decided.
 */
export function memberWeights(committee: string[], rules: QuorumRules): Map<string, bigint> {
  const members = [...new Set(committee)];
  if (rules.weighting === QuorumWeighting.STAKE) {
    const staked = new Map(members.map((id) => [id, parseStake(rules.weights[id])]));
    const total = [...staked.values()].reduce((sum, weight) => sum + weight, 0n);
    if (total > 0n) return staked;
  }
  return new Map(members.map((id) => [id, 1n]));
}

/**
 * Tallies revealed votes against the weight of the whole committee, not of
 * the votes cast: silent validators keep their weight in the denominator, so
 * staying away never makes it easier for the others to reach a verdict.
 * Votes from validators that are not on the committee count for nothing.
 */
export function tallyWeighted(
  votes: RevealedVote[],
  committee: string[],
  rules: QuorumRules,
): WeightedTally {
  const weightOf = memberWeights(committee, rules);
  const totals: Record<VerdictOutcome, bigint> = {
    [VerdictOutcome.ACCEPT]: 0n,
    [VerdictOutcome.PARTIAL]: 0n,
    [VerdictOutcome.REJECT]: 0n,
  };
  // One vote per validator, whatever the caller passes in: the first counts.
  const firstVote = new Map<string, VerdictOutcome>();
  for (const vote of votes) {
    if (!firstVote.has(vote.validatorId)) firstVote.set(vote.validatorId, vote.outcome);
  }
  for (const [validatorId, outcome] of firstVote) {
    totals[outcome] += weightOf.get(validatorId) ?? 0n;
  }

  const totalWeight = [...weightOf.values()].reduce((sum, weight) => sum + weight, 0n);
  const required = requiredWeight(totalWeight, rules.thresholdBps);
  const winner = (Object.keys(totals) as VerdictOutcome[]).find(
    (outcome) => totals[outcome] >= required,
  );

  const supporters = winner
    ? [...firstVote]
        .filter(([validatorId, outcome]) => outcome === winner && weightOf.has(validatorId))
        .map(([validatorId]) => validatorId)
    : [];

  return {
    outcome: winner ?? null,
    supporters,
    weighting: rules.weighting,
    thresholdBps: rules.thresholdBps,
    weights: {
      [VerdictOutcome.ACCEPT]: totals[VerdictOutcome.ACCEPT].toString(),
      [VerdictOutcome.PARTIAL]: totals[VerdictOutcome.PARTIAL].toString(),
      [VerdictOutcome.REJECT]: totals[VerdictOutcome.REJECT].toString(),
    },
    totalWeight: totalWeight.toString(),
    requiredWeight: required.toString(),
  };
}
