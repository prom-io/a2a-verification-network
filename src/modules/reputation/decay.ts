/**
 * Time decay for reputation.
 *
 * Reputation is evidence about how a validator behaved, and evidence goes
 * stale: a perfect record from a year ago says little about the node running
 * today. Two things decay with the same half-life:
 *
 *  - the weight of past observations when a new one is folded in, so recent
 *    behaviour dominates the averages;
 *  - the distance between the score and a neutral value when the score is
 *    read, so an idle validator drifts back to "unknown" instead of keeping
 *    a rank it no longer earns (or a stain it has long since outlived).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const daysToMs = (days: number): number => days * DAY_MS;

/**
 * Fraction of the original signal left after `elapsedMs`: 1 at zero, 0.5 after
 * one half-life, 0.25 after two. A non-positive half-life switches decay off.
 */
export function decayFactor(elapsedMs: number, halfLifeMs: number): number {
  if (!(halfLifeMs > 0) || !(elapsedMs > 0)) return 1;
  return Math.pow(0.5, elapsedMs / halfLifeMs);
}

/** Moves `value` towards `baseline`, keeping `factor` of the distance. */
export function decayToward(value: number, baseline: number, factor: number): number {
  return baseline + (value - baseline) * factor;
}

export interface ReputationComponents {
  /** Share of verdicts that held up, 0..1. */
  accuracy: number;
  /** Share of the time the validator was reachable, 0..1. */
  uptime: number;
  /** Share of observations that were lost disputes, 0..1. */
  disputeLossRate: number;
}

/** Single 0..1 score: accuracy counts most, then uptime, then disputes. */
export function compositeScore(components: ReputationComponents): number {
  const score =
    0.5 * components.accuracy +
    0.3 * components.uptime +
    0.2 * (1 - components.disputeLossRate);
  return Math.min(1, Math.max(0, score));
}

/**
 * Folds one observation (0..1) into a running mean whose accumulated weight
 * has first been decayed by `factor`. With no decay this is the ordinary
 * incremental mean; with decay an old streak is outweighed by a few recent
 * observations.
 */
export function foldObservation(
  mean: number,
  weight: number,
  observation: number,
  factor: number,
): { mean: number; weight: number } {
  const decayedWeight = Math.max(0, weight) * factor;
  const nextWeight = decayedWeight + 1;
  return {
    mean: (mean * decayedWeight + observation) / nextWeight,
    weight: nextWeight,
  };
}
