import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { daysToMs } from './decay';
import { EntityType, ReputationScore } from './entities/reputation-score.entity';
import { ReputationService } from './reputation.service';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - daysToMs(days));

function build(seed: Partial<ReputationScore>[] = [], config: Record<string, unknown> = {}) {
  const rows = seed.map(
    (row, i) =>
      ({
        id: `rep-${i + 1}`,
        entityType: EntityType.VALIDATOR,
        accuracy: '1.0000',
        uptime: '1.0000',
        disputeLossRate: '0.0000',
        totalJobs: 0,
        evidenceWeight: '0',
        lastActivityAt: null,
        lastUpdated: NOW,
        ...row,
      }) as ReputationScore,
  );
  const repo = {
    create: jest.fn((data: Partial<ReputationScore>) => ({ ...data }) as ReputationScore),
    save: jest.fn(async (score: ReputationScore) => {
      if (!rows.includes(score)) {
        score.id = `rep-${rows.length + 1}`;
        rows.push(score);
      }
      return score;
    }),
    findOneBy: jest.fn(async ({ entityId }: { entityId: string }) =>
      rows.find((row) => row.entityId === entityId) ?? null,
    ),
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => config[key] ?? fallback),
  };
  const service = new ReputationService(
    repo as unknown as Repository<ReputationScore>,
    configService as unknown as ConfigService,
  );
  return { service, rows, repo };
}

describe('ReputationService decay on read', () => {
  it('reports the stored score unchanged for an entity seen just now', async () => {
    const { service } = build([{ entityId: 'v1', accuracy: '0.9000', lastActivityAt: NOW }]);

    const view = await service.findByEntityId('v1', NOW);

    expect(view.rawScore).toBe(0.95);
    expect(view.effectiveScore).toBe(0.95);
    expect(view.decayFactor).toBe(1);
    expect(view.halfLifeDays).toBe(30);
  });

  it('halves the distance to the neutral score after one half-life', async () => {
    const { service } = build([{ entityId: 'v1', lastActivityAt: daysAgo(30) }]);

    const view = await service.findByEntityId('v1', NOW);

    expect(view.rawScore).toBe(1);
    expect(view.decayFactor).toBeCloseTo(0.5, 6);
    expect(view.effectiveScore).toBe(0.75);
  });

  it('lets a bad record fade towards neutral as well', async () => {
    const { service } = build([
      {
        entityId: 'v1',
        accuracy: '0.0000',
        uptime: '0.0000',
        disputeLossRate: '1.0000',
        lastActivityAt: daysAgo(60),
      },
    ]);

    const view = await service.findByEntityId('v1', NOW);

    expect(view.rawScore).toBe(0);
    expect(view.effectiveScore).toBe(0.375);
  });

  it('never changes the stored components when reading', async () => {
    const { service, repo, rows } = build([{ entityId: 'v1', lastActivityAt: daysAgo(300) }]);

    const view = await service.findByEntityId('v1', NOW);

    expect(view.accuracy).toBe('1.0000');
    expect(rows[0].accuracy).toBe('1.0000');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('honours the configured half-life and neutral score', async () => {
    const { service } = build([{ entityId: 'v1', lastActivityAt: daysAgo(7) }], {
      'reputation.halfLifeDays': 7,
      'reputation.neutralScore': 0.2,
    });

    const view = await service.findByEntityId('v1', NOW);

    expect(view.halfLifeDays).toBe(7);
    expect(view.effectiveScore).toBe(0.6);
  });

  it('does not decay when the half-life is zero', async () => {
    const { service } = build([{ entityId: 'v1', lastActivityAt: daysAgo(900) }], {
      'reputation.halfLifeDays': 0,
    });

    expect((await service.findByEntityId('v1', NOW)).effectiveScore).toBe(1);
  });

  it('falls back to the last update for rows without tracked activity', async () => {
    const { service } = build([{ entityId: 'v1', lastActivityAt: null, lastUpdated: daysAgo(30) }]);

    expect((await service.findByEntityId('v1', NOW)).effectiveScore).toBe(0.75);
  });

  it('reports an unknown entity as not found', async () => {
    const { service } = build();

    await expect(service.findByEntityId('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReputationService observations', () => {
  it('creates the score on the first observation', async () => {
    const { service } = build();

    const score = await service.recordObservation('v1', EntityType.VALIDATOR, { accurate: true }, NOW);

    expect(score).toMatchObject({
      entityId: 'v1',
      entityType: EntityType.VALIDATOR,
      accuracy: '1.0000',
      disputeLossRate: '0.0000',
      totalJobs: 1,
      evidenceWeight: '1.000000',
      lastActivityAt: NOW,
    });
  });

  it('averages observations made close together', async () => {
    const { service } = build();
    for (const accurate of [true, true, true, false]) {
      await service.recordObservation('v1', EntityType.VALIDATOR, { accurate }, NOW);
    }

    const view = await service.findByEntityId('v1', NOW);

    expect(view.accuracy).toBe('0.7500');
    expect(view.totalJobs).toBe(4);
    expect(view.evidenceWeight).toBe('4.000000');
  });

  it('discounts old evidence before folding in a new observation', async () => {
    const { service } = build([
      { entityId: 'stale', accuracy: '1.0000', evidenceWeight: '10', lastActivityAt: daysAgo(90) },
      { entityId: 'fresh', accuracy: '1.0000', evidenceWeight: '10', lastActivityAt: NOW },
    ]);

    const stale = await service.recordObservation('stale', EntityType.VALIDATOR, { accurate: false }, NOW);
    const fresh = await service.recordObservation('fresh', EntityType.VALIDATOR, { accurate: false }, NOW);

    // Ten old jobs weigh 1.25 after three half-lives; ten recent ones weigh 10.
    expect(stale.accuracy).toBe('0.5556');
    expect(stale.evidenceWeight).toBe('2.250000');
    expect(fresh.accuracy).toBe('0.9091');
  });

  it('records a lost dispute as inaccurate without counting a job', async () => {
    const { service } = build([
      { entityId: 'v1', evidenceWeight: '3', totalJobs: 3, lastActivityAt: NOW },
    ]);

    const score = await service.recordObservation(
      'v1',
      EntityType.VALIDATOR,
      { accurate: false, disputeLost: true },
      NOW,
    );

    expect(score.accuracy).toBe('0.7500');
    expect(score.disputeLossRate).toBe('0.2500');
    expect(score.totalJobs).toBe(3);
  });

  it('records every validator and survives a failing one', async () => {
    const { service, repo, rows } = build();
    repo.save.mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(
      service.recordForValidators(['v1', 'v2', 'v3'], { accurate: true }, NOW),
    ).resolves.toBeUndefined();

    expect(rows.map((row) => row.entityId)).toEqual(['v2', 'v3']);
  });

  it('keeps upsert for callers that set components directly', async () => {
    const { service } = build([{ entityId: 'v1' }]);

    const updated = await service.upsert({ entityId: 'v1', uptime: '0.5000' });
    const created = await service.upsert({ entityId: 'v2', entityType: EntityType.AGENT });

    expect(updated.uptime).toBe('0.5000');
    expect(created.entityId).toBe('v2');
  });
});
