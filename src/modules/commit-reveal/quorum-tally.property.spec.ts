import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import { RevealedVote, tallyReveals } from './commitment';
import { QuorumRules, QuorumWeighting, tallyWeighted } from './weighted-quorum';

/**
 * Property tests for the quorum tally. Instead of a handful of examples they
 * check rules that must hold for every committee: exhaustively for 3-of-5,
 * and over a few thousand seeded random committees for stake weighting.
 */

const OUTCOMES = [VerdictOutcome.ACCEPT, VerdictOutcome.PARTIAL, VerdictOutcome.REJECT];
const SEATS = ['v1', 'v2', 'v3', 'v4', 'v5'];

/** Small deterministic PRNG (mulberry32), so a failure can be replayed. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Every way five seats can vote: each seat is silent or picks one outcome. */
function* allBallots(): Generator<RevealedVote[]> {
  for (let code = 0; code < 4 ** SEATS.length; code++) {
    const votes: RevealedVote[] = [];
    let rest = code;
    for (const seat of SEATS) {
      const choice = rest % 4;
      rest = Math.floor(rest / 4);
      if (choice > 0) votes.push({ validatorId: seat, outcome: OUTCOMES[choice - 1] });
    }
    yield votes;
  }
}

const equal = (thresholdBps = 5001): QuorumRules => ({
  weighting: QuorumWeighting.EQUAL,
  thresholdBps,
  weights: {},
});

const count = (votes: RevealedVote[], outcome: VerdictOutcome) =>
  votes.filter((vote) => vote.outcome === outcome).length;

describe('3-of-5 quorum, every possible ballot', () => {
  const ballots = [...allBallots()];

  it('enumerates all 1024 ballots', () => {
    expect(ballots).toHaveLength(1024);
  });

  it('decides exactly when one outcome has three or more votes', () => {
    for (const votes of ballots) {
      const tally = tallyWeighted(votes, SEATS, equal());
      const expected = OUTCOMES.find((outcome) => count(votes, outcome) >= 3) ?? null;
      expect({ votes, outcome: tally.outcome }).toEqual({ votes, outcome: expected });
    }
  });

  it('names exactly the validators that voted for the winner as supporters', () => {
    for (const votes of ballots) {
      const tally = tallyWeighted(votes, SEATS, equal());
      const expected = tally.outcome
        ? votes.filter((vote) => vote.outcome === tally.outcome).map((vote) => vote.validatorId)
        : [];
      expect(tally.supporters).toEqual(expected);
    }
  });

  it('agrees with the head-count tally the round reports', () => {
    for (const votes of ballots) {
      const weighted = tallyWeighted(votes, SEATS, equal());
      const counted = tallyReveals(votes, SEATS.length);
      expect(weighted.outcome).toBe(counted.outcome);
      expect(weighted.supporters).toEqual(counted.supporters);
      expect(weighted.requiredWeight).toBe(String(counted.quorum));
    }
  });

  it('never lets silence help: two votes are not enough however many stay away', () => {
    for (const votes of ballots) {
      if (votes.length <= 2) {
        expect(tallyWeighted(votes, SEATS, equal()).outcome).toBeNull();
      }
    }
  });

  it('keeps a decision when a silent seat joins the winning side', () => {
    for (const votes of ballots) {
      const tally = tallyWeighted(votes, SEATS, equal());
      if (!tally.outcome) continue;
      const silent = SEATS.find((seat) => !votes.some((vote) => vote.validatorId === seat));
      if (!silent) continue;
      const more = [...votes, { validatorId: silent, outcome: tally.outcome }];
      expect(tallyWeighted(more, SEATS, equal()).outcome).toBe(tally.outcome);
    }
  });

  it('needs four votes at a 4-of-5 threshold and all five at unanimity', () => {
    for (const votes of ballots) {
      const best = Math.max(...OUTCOMES.map((outcome) => count(votes, outcome)));
      expect(tallyWeighted(votes, SEATS, equal(8000)).outcome !== null).toBe(best >= 4);
      expect(tallyWeighted(votes, SEATS, equal(10_000)).outcome !== null).toBe(best === 5);
    }
  });
});

describe('stake-weighted quorum, random committees', () => {
  const RUNS = 2000;

  /** A random committee of 1..9 seats with stakes from 0 to 10^24 wei, and random ballots. */
  function randomCase(random: () => number) {
    const size = 1 + Math.floor(random() * 9);
    const committee = Array.from({ length: size }, (_, i) => `s${i}`);
    const weights: Record<string, string> = {};
    for (const seat of committee) {
      const magnitude = BigInt(Math.floor(random() * 1e6)) * 10n ** BigInt(Math.floor(random() * 19));
      weights[seat] = magnitude.toString();
    }
    const votes: RevealedVote[] = committee
      .filter(() => random() < 0.8)
      .map((seat) => ({ validatorId: seat, outcome: OUTCOMES[Math.floor(random() * 3)] }));
    const thresholdBps = 5001 + Math.floor(random() * 5000);
    return { committee, weights, votes, thresholdBps };
  }

  /** The rule written out independently: winner weight * 10000 >= total * bps. */
  function reference(c: ReturnType<typeof randomCase>): VerdictOutcome | null {
    const stake = (seat: string) => BigInt(c.weights[seat]);
    let total = c.committee.reduce((sum, seat) => sum + stake(seat), 0n);
    const weightOf = (seat: string) => (total === 0n ? 1n : stake(seat));
    if (total === 0n) total = BigInt(c.committee.length);
    for (const outcome of OUTCOMES) {
      const behind = c.votes
        .filter((vote) => vote.outcome === outcome)
        .reduce((sum, vote) => sum + weightOf(vote.validatorId), 0n);
      if (behind > 0n && behind * 10_000n >= total * BigInt(c.thresholdBps)) return outcome;
    }
    return null;
  }

  const rules = (c: ReturnType<typeof randomCase>, overrides: Partial<QuorumRules> = {}) => ({
    weighting: QuorumWeighting.STAKE,
    thresholdBps: c.thresholdBps,
    weights: c.weights,
    ...overrides,
  });

  it('matches an independent statement of the rule', () => {
    const random = prng(0x5eed);
    for (let run = 0; run < RUNS; run++) {
      const c = randomCase(random);
      expect({ run, outcome: tallyWeighted(c.votes, c.committee, rules(c)).outcome }).toEqual({
        run,
        outcome: reference(c),
      });
    }
  });

  it('never lets more than one outcome reach a threshold above one half', () => {
    const random = prng(1);
    for (let run = 0; run < RUNS; run++) {
      const c = randomCase(random);
      const tally = tallyWeighted(c.votes, c.committee, rules(c));
      const required = BigInt(tally.requiredWeight);
      const reaching = OUTCOMES.filter((outcome) => BigInt(tally.weights[outcome]) >= required);
      expect(reaching.length).toBeLessThanOrEqual(1);
    }
  });

  it('does not depend on the order the reveals arrive in', () => {
    const random = prng(2);
    for (let run = 0; run < RUNS; run++) {
      const c = randomCase(random);
      const tally = tallyWeighted(c.votes, c.committee, rules(c));
      const shuffled = tallyWeighted(shuffle(c.votes, random), c.committee, rules(c));
      expect(shuffled.outcome).toBe(tally.outcome);
      expect(shuffled.weights).toEqual(tally.weights);
      expect([...shuffled.supporters].sort()).toEqual([...tally.supporters].sort());
    }
  });

  it('gives the same result when every stake is scaled by the same factor', () => {
    const random = prng(3);
    for (let run = 0; run < RUNS; run++) {
      const c = randomCase(random);
      const factor = BigInt(2 + Math.floor(random() * 1000));
      const scaled = Object.fromEntries(
        Object.entries(c.weights).map(([seat, stake]) => [seat, (BigInt(stake) * factor).toString()]),
      );
      expect(tallyWeighted(c.votes, c.committee, rules(c, { weights: scaled })).outcome).toBe(
        tallyWeighted(c.votes, c.committee, rules(c)).outcome,
      );
    }
  });

  it('reaches the same decision at any lower threshold', () => {
    const random = prng(4);
    for (let run = 0; run < RUNS; run++) {
      const c = randomCase(random);
      const decided = tallyWeighted(c.votes, c.committee, rules(c)).outcome;
      if (!decided) continue;
      const lower = 5001 + Math.floor(random() * (c.thresholdBps - 5001 + 1));
      expect(tallyWeighted(c.votes, c.committee, rules(c, { thresholdBps: lower })).outcome).toBe(decided);
    }
  });

  it('equals head counting when every stake is the same', () => {
    const random = prng(5);
    for (let run = 0; run < RUNS; run++) {
      const c = randomCase(random);
      const flat = Object.fromEntries(c.committee.map((seat) => [seat, '7000000000000000000']));
      expect(tallyWeighted(c.votes, c.committee, rules(c, { weights: flat })).outcome).toBe(
        tallyWeighted(c.votes, c.committee, rules(c, { weighting: QuorumWeighting.EQUAL })).outcome,
      );
    }
  });

  it('cannot be swung by votes from outside the committee', () => {
    const random = prng(6);
    for (let run = 0; run < RUNS; run++) {
      const c = randomCase(random);
      const intruders: RevealedVote[] = OUTCOMES.map((outcome, i) => ({
        validatorId: `outsider-${i}`,
        outcome,
      }));
      const withIntruders = { ...c.weights, 'outsider-0': '1'.padEnd(30, '0') };
      const tally = tallyWeighted([...c.votes, ...intruders], c.committee, rules(c, { weights: withIntruders }));
      expect(tally.outcome).toBe(tallyWeighted(c.votes, c.committee, rules(c)).outcome);
      expect(tally.supporters.some((id) => id.startsWith('outsider'))).toBe(false);
    }
  });
});
