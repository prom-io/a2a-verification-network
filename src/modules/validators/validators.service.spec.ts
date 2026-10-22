import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Validator } from './entities/validator.entity';
import { StakingTier } from './staking-tiers';
import { ValidatorsService } from './validators.service';

const ETHER = 10n ** 18n;

function repoStub(rows: Partial<Validator>[] = []) {
  const store = rows.map((row) => ({ isActive: true, ...row })) as Validator[];
  const repo = {
    create: jest.fn((data: Partial<Validator>) => ({ id: `v${store.length + 1}`, isActive: true, ...data })),
    save: jest.fn(async (entity: Validator) => {
      const index = store.findIndex((row) => row.id === entity.id);
      if (index >= 0) store[index] = entity;
      else store.push(entity);
      return entity;
    }),
    find: jest.fn(async () => store),
    findBy: jest.fn(async (where: Partial<Validator>) =>
      store.filter((row) => row.isActive === where.isActive),
    ),
    findOneBy: jest.fn(async ({ id }: { id: string }) => store.find((row) => row.id === id) ?? null),
  };
  return { repo: repo as unknown as Repository<Validator>, store };
}

function configStub(minStakeWei?: string): ConfigService {
  return {
    get: jest.fn((_key: string, fallback?: string) => minStakeWei ?? fallback),
  } as unknown as ConfigService;
}

const dto = (stake: string) => ({
  address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  publicKey: `0x${'ab'.repeat(33)}`,
  stake,
  endpoint: 'http://validator-1:9090',
});

describe('ValidatorsService staking tiers', () => {
  it('assigns the tier matching the stake at registration', async () => {
    const { repo } = repoStub();
    const service = new ValidatorsService(repo, configStub());

    const gold = await service.register(dto((25n * ETHER).toString()));
    const unstaked = await service.register(dto('1000'));

    expect(gold.tier).toBe(StakingTier.GOLD);
    expect(unstaked.tier).toBe(StakingTier.NONE);
  });

  it('derives the thresholds from the configured minimum stake', async () => {
    const { repo } = repoStub();
    const service = new ValidatorsService(repo, configStub('1000'));

    expect(service.tierTable()).toEqual([
      { tier: StakingTier.BRONZE, minStakeWei: '1000', weight: 1 },
      { tier: StakingTier.SILVER, minStakeWei: '5000', weight: 2 },
      { tier: StakingTier.GOLD, minStakeWei: '20000', weight: 4 },
      { tier: StakingTier.PLATINUM, minStakeWei: '100000', weight: 8 },
    ]);
    expect((await service.register(dto('5000'))).tier).toBe(StakingTier.SILVER);
  });

  it('moves a validator between tiers when its stake changes', async () => {
    const { repo } = repoStub([{ id: 'v1', stake: ETHER.toString(), tier: StakingTier.BRONZE }]);
    const service = new ValidatorsService(repo, configStub());

    const promoted = await service.updateStake('v1', (100n * ETHER).toString());
    expect(promoted.tier).toBe(StakingTier.PLATINUM);

    const demoted = await service.updateStake('v1', '0');
    expect(demoted.tier).toBe(StakingTier.NONE);
    expect(demoted.stake).toBe('0');
  });

  it('rejects a stake update for an unknown validator', async () => {
    const { repo } = repoStub();
    const service = new ValidatorsService(repo, configStub());

    await expect(service.updateStake('missing', '1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists only active validators holding at least the minimum stake as eligible', async () => {
    const { repo } = repoStub([
      { id: 'bronze', stake: ETHER.toString() },
      { id: 'platinum', stake: (500n * ETHER).toString() },
      { id: 'understaked', stake: (ETHER - 1n).toString() },
      { id: 'exited', stake: (50n * ETHER).toString(), isActive: false },
    ]);
    const service = new ValidatorsService(repo, configStub());

    expect(await service.findEligible()).toEqual([
      { id: 'bronze', tier: StakingTier.BRONZE, weight: 1 },
      { id: 'platinum', tier: StakingTier.PLATINUM, weight: 8 },
    ]);
  });

  it('recomputes eligibility from the stake, not from a stale tier column', async () => {
    const { repo } = repoStub([{ id: 'v1', stake: '10', tier: StakingTier.PLATINUM }]);
    const service = new ValidatorsService(repo, configStub());

    expect(await service.findEligible()).toEqual([]);
  });

  it('deactivates a validator on exit', async () => {
    const { repo } = repoStub([{ id: 'v1', stake: ETHER.toString() }]);
    const service = new ValidatorsService(repo, configStub());

    expect((await service.exit('v1')).isActive).toBe(false);
    expect(await service.findEligible()).toEqual([]);
  });
});
