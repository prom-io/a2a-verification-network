import { EligibleValidator } from '../validators/validator-set.cache';

export interface ScoredCandidate extends EligibleValidator {
  /** Effective (time-decayed) reputation; unrated validators sit at the neutral score. */
  score: number;
  qualifies: boolean;
}

/** Reads a policy's minimum as stored (a decimal string); anything unusable means no gate. */
export function parseMinScore(value: string | number | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(1, parsed);
}

/**
 * Marks which candidates meet the minimum score. Scores are compared at four
 * decimals, the precision reputation is stored with, so a validator sitting
 * exactly on the minimum is not excluded by floating-point noise.
 */
export function scoreCandidates(
  candidates: ReadonlyArray<EligibleValidator>,
  scores: ReadonlyMap<string, number>,
  minScore: number,
  neutralScore: number,
): ScoredCandidate[] {
  const threshold = Math.round(minScore * 10_000);
  return candidates.map((candidate) => {
    const score = scores.get(candidate.id) ?? neutralScore;
    return { ...candidate, score, qualifies: Math.round(score * 10_000) >= threshold };
  });
}
