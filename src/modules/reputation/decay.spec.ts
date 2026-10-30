import { compositeScore, daysToMs, decayFactor, decayToward, foldObservation } from './decay';

const HALF_LIFE = daysToMs(30);

describe('decayFactor', () => {
  it('halves with every half-life', () => {
    expect(decayFactor(0, HALF_LIFE)).toBe(1);
    expect(decayFactor(HALF_LIFE, HALF_LIFE)).toBeCloseTo(0.5, 10);
    expect(decayFactor(2 * HALF_LIFE, HALF_LIFE)).toBeCloseTo(0.25, 10);
    expect(decayFactor(daysToMs(15), HALF_LIFE)).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('does not decay for timestamps in the future', () => {
    // Clock skew between nodes must not inflate a score above its stored value.
    expect(decayFactor(-daysToMs(5), HALF_LIFE)).toBe(1);
  });

  it('is switched off by a non-positive half-life', () => {
    expect(decayFactor(daysToMs(365), 0)).toBe(1);
    expect(decayFactor(daysToMs(365), -1)).toBe(1);
    expect(decayFactor(daysToMs(365), Number.NaN)).toBe(1);
  });
});

describe('decayToward', () => {
  it('keeps the given share of the distance to the baseline', () => {
    expect(decayToward(1, 0.5, 1)).toBe(1);
    expect(decayToward(1, 0.5, 0.5)).toBe(0.75);
    expect(decayToward(1, 0.5, 0)).toBe(0.5);
  });

  it('lifts scores below the baseline as well', () => {
    expect(decayToward(0.1, 0.5, 0.5)).toBeCloseTo(0.3, 10);
  });
});

describe('compositeScore', () => {
  it('weighs accuracy, uptime and dispute losses', () => {
    expect(compositeScore({ accuracy: 1, uptime: 1, disputeLossRate: 0 })).toBe(1);
    expect(compositeScore({ accuracy: 0, uptime: 0, disputeLossRate: 1 })).toBe(0);
    expect(compositeScore({ accuracy: 0.8, uptime: 0.9, disputeLossRate: 0.25 })).toBeCloseTo(
      0.4 + 0.27 + 0.15,
      10,
    );
  });

  it('stays within 0..1 for out-of-range inputs', () => {
    expect(compositeScore({ accuracy: 2, uptime: 2, disputeLossRate: -1 })).toBe(1);
    expect(compositeScore({ accuracy: -1, uptime: -1, disputeLossRate: 3 })).toBe(0);
  });
});

describe('foldObservation', () => {
  it('is the incremental mean when nothing decays', () => {
    let state = { mean: 0, weight: 0 };
    for (const observation of [1, 1, 0, 1]) {
      state = foldObservation(state.mean, state.weight, observation, 1);
    }

    expect(state.mean).toBeCloseTo(0.75, 10);
    expect(state.weight).toBe(4);
  });

  it('takes the first observation as is', () => {
    expect(foldObservation(1, 0, 0, 1)).toEqual({ mean: 0, weight: 1 });
  });

  it('lets a recent observation outweigh a stale streak', () => {
    // Ten perfect jobs, then a failure.
    const fresh = foldObservation(1, 10, 0, 1);
    const stale = foldObservation(1, 10, 0, decayFactor(3 * HALF_LIFE, HALF_LIFE));

    expect(fresh.mean).toBeCloseTo(10 / 11, 10);
    expect(stale.mean).toBeCloseTo(1.25 / 2.25, 10);
    expect(stale.mean).toBeLessThan(fresh.mean);
    expect(stale.weight).toBeCloseTo(2.25, 10);
  });

  it('never works with a negative weight', () => {
    expect(foldObservation(0.5, -3, 1, 1)).toEqual({ mean: 1, weight: 1 });
  });
});
