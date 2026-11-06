import { DEFAULT_PRIORITY_OPTIONS, orderQueue, parseFee, priorityScore } from './priority';

const UNIT = DEFAULT_PRIORITY_OPTIONS.feeUnitWei;
const NOW = new Date('2026-05-01T12:00:00.000Z');
const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

const job = (id: string, feeUnits: number, waitedSeconds: number) => ({
  id,
  fee: (BigInt(Math.round(feeUnits * 1000)) * UNIT / 1000n).toString(),
  submittedAt: secondsAgo(waitedSeconds),
});

describe('priorityScore', () => {
  it('is the fee in fee units for a job that has just arrived', () => {
    expect(priorityScore(0n, 0)).toBe(0);
    expect(priorityScore(UNIT, 0)).toBe(1);
    expect(priorityScore(UNIT * 5n / 2n, 0)).toBe(2.5);
  });

  it('adds one point per aging interval of waiting', () => {
    expect(priorityScore(0n, 60_000)).toBe(1);
    expect(priorityScore(UNIT, 90_000)).toBe(2.5);
  });

  it('ignores negative waiting times from clock skew', () => {
    expect(priorityScore(UNIT, -5_000)).toBe(1);
  });

  it('handles fees far beyond the range of a double', () => {
    const huge = 10n ** 40n;

    expect(priorityScore(huge, 0) / 1e25).toBeCloseTo(1, 10);
    expect(priorityScore(huge, 0)).toBeGreaterThan(priorityScore(huge / 2n, 0));
  });

  it('honours custom units and can switch aging off', () => {
    expect(priorityScore(500n, 0, { feeUnitWei: 100n, agingSeconds: 60 })).toBe(5);
    expect(priorityScore(0n, 600_000, { feeUnitWei: UNIT, agingSeconds: 0 })).toBe(0);
    expect(priorityScore(UNIT, 0, { feeUnitWei: 0n, agingSeconds: 60 })).toBe(0);
  });
});

describe('parseFee', () => {
  it('reads numeric column values and rejects everything else', () => {
    expect(parseFee('1500')).toBe(1500n);
    expect(parseFee('1500.000')).toBe(1500n);
    expect(parseFee(7n)).toBe(7n);
    expect(parseFee(-7n)).toBe(0n);
    expect(parseFee(null)).toBe(0n);
    expect(parseFee('1e18')).toBe(0n);
  });
});

describe('orderQueue', () => {
  it('puts the highest fee first among jobs of the same age', () => {
    const ordered = orderQueue([job('low', 1, 10), job('none', 0, 10), job('high', 5, 10)], NOW);

    expect(ordered.map((entry) => entry.job.id)).toEqual(['high', 'low', 'none']);
    expect(ordered.map((entry) => entry.position)).toEqual([1, 2, 3]);
  });

  it('lets an old free job overtake a fresh paid one', () => {
    // Five minutes of waiting is worth five units; the paid job offers three.
    const ordered = orderQueue([job('paid', 3, 0), job('patient', 0, 300)], NOW);

    expect(ordered.map((entry) => entry.job.id)).toEqual(['patient', 'paid']);
    expect(ordered[0]).toMatchObject({ score: 5, waitedSeconds: 300 });
    expect(ordered[1]).toMatchObject({ score: 3, waitedSeconds: 0 });
  });

  it('keeps a paid job ahead until the free job has waited long enough', () => {
    const ordered = orderQueue([job('paid', 3, 0), job('waiting', 0, 120)], NOW);

    expect(ordered.map((entry) => entry.job.id)).toEqual(['paid', 'waiting']);
  });

  it('breaks ties by submission time and then by id', () => {
    const ordered = orderQueue(
      [
        { id: 'b', fee: '0', submittedAt: NOW },
        { id: 'a', fee: '0', submittedAt: NOW },
        { id: 'older', fee: UNIT.toString(), submittedAt: secondsAgo(60) },
        { id: 'newer', fee: (2n * UNIT).toString(), submittedAt: NOW },
      ],
      NOW,
    );

    // 'older' and 'newer' both score 2; the earlier submission wins.
    expect(ordered.map((entry) => entry.job.id)).toEqual(['older', 'newer', 'a', 'b']);
  });

  it('does not mutate its input and handles an empty queue', () => {
    const jobs = [job('b', 0, 0), job('a', 9, 0)];

    orderQueue(jobs, NOW);

    expect(jobs.map((j) => j.id)).toEqual(['b', 'a']);
    expect(orderQueue([], NOW)).toEqual([]);
  });
});
