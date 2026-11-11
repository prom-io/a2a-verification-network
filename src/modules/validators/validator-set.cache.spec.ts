import { ConfigService } from '@nestjs/config';
import { StakingTier } from './staking-tiers';
import { EligibleValidator, ValidatorSetCache } from './validator-set.cache';

const T0 = new Date('2026-04-01T10:00:00.000Z'); // start of a 30 s epoch
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const set = (...ids: string[]): EligibleValidator[] =>
  ids.map((id) => ({ id, tier: StakingTier.SILVER, weight: 2 }));

function build(epochSeconds?: string) {
  const config = {
    get: jest.fn((_key: string, fallback?: unknown) => epochSeconds ?? fallback),
  } as unknown as ConfigService;
  return new ValidatorSetCache(config);
}

describe('ValidatorSetCache', () => {
  it('loads the set once per epoch', async () => {
    const cache = build();
    const load = jest.fn().mockResolvedValue(set('a', 'b'));

    const first = await cache.get(load, at(0));
    for (let i = 1; i < 100; i++) await cache.get(load, at(i * 0.25));

    expect(load).toHaveBeenCalledTimes(1);
    expect(first.validators.map((v) => v.id)).toEqual(['a', 'b']);
    expect(first.totalWeight).toBe(4);
    expect(cache.stats()).toEqual({ hits: 99, misses: 1, cachedEpoch: first.epoch });
  });

  it('takes a new snapshot when the epoch rolls over', async () => {
    const cache = build();
    const load = jest.fn().mockResolvedValueOnce(set('a')).mockResolvedValueOnce(set('a', 'b'));

    const first = await cache.get(load, at(29));
    const second = await cache.get(load, at(30));

    expect(load).toHaveBeenCalledTimes(2);
    expect(second.epoch).toBe(first.epoch + 1);
    expect(second.validators).toHaveLength(2);
    expect(second.takenAt).toEqual(at(30));
  });

  it('honours the configured epoch length', async () => {
    const cache = build('5');
    const load = jest.fn().mockResolvedValue(set('a'));

    await cache.get(load, at(0));
    await cache.get(load, at(4));
    await cache.get(load, at(5));

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads after an invalidation within the same epoch', async () => {
    const cache = build();
    const load = jest.fn().mockResolvedValueOnce(set('a')).mockResolvedValueOnce(set('a', 'new'));

    await cache.get(load, at(1));
    cache.invalidate();
    const after = await cache.get(load, at(2));

    expect(load).toHaveBeenCalledTimes(2);
    expect(after.validators.map((v) => v.id)).toEqual(['a', 'new']);
  });

  it('shares one read between concurrent callers', async () => {
    const cache = build();
    let release: (value: EligibleValidator[]) => void = () => undefined;
    const load = jest.fn(
      () => new Promise<EligibleValidator[]>((resolve) => (release = resolve)),
    );

    const callers = Array.from({ length: 20 }, () => cache.get(load, at(1)));
    release(set('a'));
    const snapshots = await Promise.all(callers);

    expect(load).toHaveBeenCalledTimes(1);
    expect(new Set(snapshots).size).toBe(1);
  });

  it('does not keep a result that a write overtook while it was loading', async () => {
    const cache = build();
    let release: (value: EligibleValidator[]) => void = () => undefined;
    const slow = jest.fn(
      () => new Promise<EligibleValidator[]>((resolve) => (release = resolve)),
    );
    const fresh = jest.fn().mockResolvedValue(set('a', 'registered-meanwhile'));

    const inFlight = cache.get(slow, at(1));
    cache.invalidate(); // a validator registers while the query is running
    release(set('a'));
    await inFlight;

    const next = await cache.get(fresh, at(2));
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(next.validators.map((v) => v.id)).toEqual(['a', 'registered-meanwhile']);
  });

  it('does not cache a failed read', async () => {
    const cache = build();
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(set('a'));

    await expect(cache.get(load, at(1))).rejects.toThrow('connection reset');
    await expect(cache.get(load, at(2))).resolves.toMatchObject({ totalWeight: 2 });
    expect(cache.stats().cachedEpoch).not.toBeNull();
  });

  it('reads through on every call when the epoch length is zero', async () => {
    const cache = build('0');
    const load = jest.fn().mockResolvedValue(set('a'));

    const snapshot = await cache.get(load, at(1));
    await cache.get(load, at(1));

    expect(load).toHaveBeenCalledTimes(2);
    expect(snapshot.epoch).toBe(-1);
    expect(cache.stats().cachedEpoch).toBeNull();
  });

  it('hands out a snapshot that callers cannot modify', async () => {
    const cache = build();
    const snapshot = await cache.get(async () => set('a'), at(1));

    expect(() => (snapshot.validators as EligibleValidator[]).push(...set('intruder'))).toThrow();
  });
});
