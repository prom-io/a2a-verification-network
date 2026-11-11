import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { Repository } from 'typeorm';
import { Validator } from './entities/validator.entity';
import { ValidatorSetCache } from './validator-set.cache';
import {
  SUSPENSION_MISSED_HEARTBEAT,
  ValidatorAvailabilityService,
  heartbeatMessage,
} from './validator-availability.service';

const NOW = new Date('2026-04-01T10:00:00.000Z');
const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

function build(seed: Partial<Validator>[] = [], env: Record<string, unknown> = {}) {
  const wallet = ethers.Wallet.createRandom();
  const rows = seed.map(
    (row, i) =>
      ({
        id: `v${i + 1}`,
        address: wallet.address,
        isActive: true,
        registeredAt: secondsAgo(3600),
        lastHeartbeatAt: null,
        suspendedAt: null,
        suspensionReason: null,
        exitedAt: null,
        ...row,
      }) as Validator,
  );
  const repo = {
    findOneBy: jest.fn(async ({ id }: { id: string }) => rows.find((row) => row.id === id) ?? null),
    findBy: jest.fn(async ({ isActive }: { isActive: boolean }) =>
      rows.filter((row) => row.isActive === isActive),
    ),
    save: jest.fn(async (validator: Validator) => validator),
  };
  const config = { get: jest.fn((key: string, fallback?: unknown) => env[key] ?? fallback) };
  const setCache = { invalidate: jest.fn() };
  const service = new ValidatorAvailabilityService(
    repo as unknown as Repository<Validator>,
    config as unknown as ConfigService,
    setCache as unknown as ValidatorSetCache,
  );

  const beat = async (id: string, timestamp = NOW.getTime(), signer: ethers.HDNodeWallet = wallet) => ({
    timestamp,
    signature: await signer.signMessage(heartbeatMessage(id, timestamp)),
  });

  return { service, rows, repo, beat, wallet, setCache };
}

describe('ValidatorAvailabilityService.heartbeat', () => {
  it('records a signed heartbeat and reports when the next one is due', async () => {
    const { service, beat, rows } = build([{}]);

    const result = await service.heartbeat('v1', await beat('v1'), NOW);

    expect(result).toMatchObject({
      validatorId: 'v1',
      isActive: true,
      reactivated: false,
      lastHeartbeatAt: NOW,
      heartbeatDueBy: new Date(NOW.getTime() + 180_000),
      suspendedAt: null,
    });
    expect(rows[0].lastHeartbeatAt).toEqual(NOW);
  });

  it('rejects a heartbeat signed by another key', async () => {
    const { service, beat, rows } = build([{}]);
    const impostor = ethers.Wallet.createRandom();

    await expect(
      service.heartbeat('v1', await beat('v1', NOW.getTime(), impostor), NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rows[0].lastHeartbeatAt).toBeNull();
  });

  it('rejects a signature made for another validator or another time', async () => {
    const { service, beat } = build([{}, {}]);

    const forOther = await beat('v2');
    await expect(service.heartbeat('v1', forOther, NOW)).rejects.toBeInstanceOf(ForbiddenException);

    const signed = await beat('v1', NOW.getTime());
    await expect(
      service.heartbeat('v1', { ...signed, timestamp: NOW.getTime() + 1 }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a malformed signature', async () => {
    const { service } = build([{}]);

    await expect(
      service.heartbeat('v1', { timestamp: NOW.getTime(), signature: `0x${'00'.repeat(65)}` }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects timestamps too far in the past or the future', async () => {
    const { service, beat } = build([{}]);

    await expect(
      service.heartbeat('v1', await beat('v1', NOW.getTime() - 121_000), NOW),
    ).rejects.toThrow('too far from the current time');
    await expect(
      service.heartbeat('v1', await beat('v1', NOW.getTime() + 121_000), NOW),
    ).rejects.toThrow('too far from the current time');
    await expect(
      service.heartbeat('v1', await beat('v1', NOW.getTime() - 119_000), NOW),
    ).resolves.toMatchObject({ isActive: true });
  });

  it('does not accept a replayed or older heartbeat', async () => {
    const { service, beat } = build([{}]);
    const first = await beat('v1', NOW.getTime());
    await service.heartbeat('v1', first, NOW);

    await expect(service.heartbeat('v1', first, NOW)).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.heartbeat('v1', await beat('v1', NOW.getTime() - 1000), NOW),
    ).rejects.toThrow('not newer than the last one');
    await expect(
      service.heartbeat('v1', await beat('v1', NOW.getTime() + 1000), NOW),
    ).resolves.toMatchObject({ reactivated: false });
  });

  it('reactivates a validator suspended for missed heartbeats', async () => {
    const { service, beat, rows } = build([
      { isActive: false, suspendedAt: secondsAgo(600), suspensionReason: SUSPENSION_MISSED_HEARTBEAT },
    ]);

    const result = await service.heartbeat('v1', await beat('v1'), NOW);

    expect(result).toMatchObject({
      isActive: true,
      reactivated: true,
      suspendedAt: null,
      suspensionReason: null,
    });
    expect(rows[0].isActive).toBe(true);
  });

  it('invalidates the validator set only when eligibility changes', async () => {
    const routine = build([{}]);
    await routine.service.heartbeat('v1', await routine.beat('v1'), NOW);
    expect(routine.setCache.invalidate).not.toHaveBeenCalled();

    const returning = build([
      { isActive: false, suspendedAt: secondsAgo(600), suspensionReason: SUSPENSION_MISSED_HEARTBEAT },
    ]);
    await returning.service.heartbeat('v1', await returning.beat('v1'), NOW);
    expect(returning.setCache.invalidate).toHaveBeenCalledTimes(1);

    const sweep = build([{ lastHeartbeatAt: secondsAgo(30) }, { lastHeartbeatAt: secondsAgo(900) }]);
    await sweep.service.suspendStale(NOW);
    expect(sweep.setCache.invalidate).toHaveBeenCalledTimes(1);
    await sweep.service.suspendStale(NOW);
    expect(sweep.setCache.invalidate).toHaveBeenCalledTimes(1);
  });

  it('does not bring back a validator that has exited', async () => {
    const { service, beat, rows } = build([{ isActive: false, exitedAt: secondsAgo(60) }]);

    await expect(service.heartbeat('v1', await beat('v1'), NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(rows[0].isActive).toBe(false);
  });

  it('reports an unknown validator as not found', async () => {
    const { service, beat } = build();

    await expect(service.heartbeat('v9', await beat('v9'), NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.availability('v9')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ValidatorAvailabilityService.suspendStale', () => {
  it('suspends active validators whose heartbeat is overdue', async () => {
    const { service, rows } = build([
      { lastHeartbeatAt: secondsAgo(30) },
      { lastHeartbeatAt: secondsAgo(181) },
      { lastHeartbeatAt: secondsAgo(180) },
    ]);

    const suspended = await service.suspendStale(NOW);

    expect(suspended).toEqual(['v2']);
    expect(rows[1]).toMatchObject({
      isActive: false,
      suspendedAt: NOW,
      suspensionReason: SUSPENSION_MISSED_HEARTBEAT,
    });
    expect(rows[0].isActive).toBe(true);
    expect(rows[2].isActive).toBe(true);
  });

  it('measures a validator that never reported from its registration', async () => {
    const { service } = build([
      { registeredAt: secondsAgo(60) },
      { registeredAt: secondsAgo(600) },
    ]);

    expect(await service.suspendStale(NOW)).toEqual(['v2']);
  });

  it('leaves exited and already suspended validators alone', async () => {
    const exitedAt = secondsAgo(5000);
    const { service, rows, repo } = build([
      { isActive: false, exitedAt, lastHeartbeatAt: secondsAgo(9000) },
      { isActive: false, suspendedAt: secondsAgo(900), lastHeartbeatAt: secondsAgo(9000) },
    ]);

    expect(await service.suspendStale(NOW)).toEqual([]);
    expect(repo.save).not.toHaveBeenCalled();
    expect(rows[0].suspendedAt).toBeNull();
  });

  it('uses the configured timeout', async () => {
    const { service } = build([{ lastHeartbeatAt: secondsAgo(40) }], {
      HEARTBEAT_TIMEOUT_SECONDS: '30',
    });

    expect(await service.suspendStale(NOW)).toEqual(['v1']);
    expect((await service.availability('v1')).heartbeatDueBy).toBeNull();
  });

  it('shows the suspension in the availability view', async () => {
    const { service } = build([{ lastHeartbeatAt: secondsAgo(500) }]);
    await service.suspendStale(NOW);

    expect(await service.availability('v1')).toEqual({
      validatorId: 'v1',
      isActive: false,
      lastHeartbeatAt: secondsAgo(500),
      heartbeatDueBy: null,
      suspendedAt: NOW,
      suspensionReason: SUSPENSION_MISSED_HEARTBEAT,
      exitedAt: null,
    });
  });
});

describe('ValidatorAvailabilityService sweep timer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stays off unless a sweep interval is configured', () => {
    const { service, repo } = build([{}]);

    service.onModuleInit();
    jest.advanceTimersByTime(600_000);

    expect(repo.findBy).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('sweeps on every tick until shutdown', async () => {
    const { service, repo } = build([{}], { HEARTBEAT_SWEEP_MS: '1000' });

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(2000);
    expect(repo.findBy).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5000);
    expect(repo.findBy).toHaveBeenCalledTimes(2);
  });
});
