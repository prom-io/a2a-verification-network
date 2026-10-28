import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ValidatorsService } from '../validators/validators.service';
import { VerdictsService } from '../verdicts/verdicts.service';
import { SlashingProposal, SlashingProposalStatus } from './entities/slashing-proposal.entity';
import { SlashingService, slashAmount } from './slashing.service';

const ETHER = 10n ** 18n;
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';

function build(options: {
  stakes?: Record<string, bigint>;
  signatures?: string[] | null;
  config?: Record<string, unknown>;
} = {}) {
  const stakes: Record<string, bigint> = options.stakes ?? { [V1]: 10n * ETHER, [V2]: 200n * ETHER };
  const signatures = options.signatures === undefined ? [V1, V2] : options.signatures;

  const rows: SlashingProposal[] = [];
  const matches = (row: SlashingProposal, where: Partial<SlashingProposal>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof SlashingProposal] === value);
  const repo = {
    create: jest.fn((data: Partial<SlashingProposal>) => ({ ...data }) as SlashingProposal),
    save: jest.fn(async (proposal: SlashingProposal) => {
      if (!proposal.id) {
        proposal.id = `proposal-${rows.length + 1}`;
        proposal.createdAt = new Date();
        rows.push(proposal);
      }
      return proposal;
    }),
    find: jest.fn(async ({ where }: { where: Partial<SlashingProposal> }) =>
      rows.filter((row) => matches(row, where)),
    ),
    findBy: jest.fn(async (where: Partial<SlashingProposal>) => rows.filter((row) => matches(row, where))),
    findOneBy: jest.fn(async (where: Partial<SlashingProposal>) => rows.find((row) => matches(row, where)) ?? null),
    update: jest.fn(async (where: Partial<SlashingProposal>, patch: Partial<SlashingProposal>) => {
      const hit = rows.filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, patch));
      return { affected: hit.length };
    }),
  };

  const validators = {
    findByIds: jest.fn(async (ids: string[]) =>
      ids.filter((id) => id in stakes).map((id) => ({ id, stake: stakes[id].toString() })),
    ),
    findOne: jest.fn(async (id: string) => {
      if (!(id in stakes)) throw new NotFoundException(`Validator ${id} not found`);
      return { id, stake: stakes[id].toString() };
    }),
    updateStake: jest.fn(async (id: string, stake: string) => {
      stakes[id] = BigInt(stake);
      return { id, stake };
    }),
  };

  const verdicts = {
    findOptionalBySessionId: jest.fn(async () =>
      signatures === null ? null : { id: 'verdict-1', sessionId: 'session-1', signatures },
    ),
  };

  const config = {
    get: jest.fn((key: string, fallback?: unknown) => options.config?.[key] ?? fallback),
  };

  const service = new SlashingService(
    repo as unknown as Repository<SlashingProposal>,
    validators as unknown as ValidatorsService,
    verdicts as unknown as VerdictsService,
    config as unknown as ConfigService,
  );
  return { service, rows, stakes, validators, repo };
}

const context = { disputeId: 'dispute-1', sessionId: 'session-1', reason: 'verdict overturned' };
const operator = { decidedBy: 'did:prom:operator-1' };

describe('slashAmount', () => {
  it('takes the configured share of the stake, rounded down to wei', () => {
    expect(slashAmount(10n * ETHER, 1000)).toBe(ETHER);
    expect(slashAmount(999n, 1000)).toBe(99n);
    expect(slashAmount(10n * ETHER, 10_000)).toBe(10n * ETHER);
  });

  it('clamps the fraction to the 0-100% range', () => {
    expect(slashAmount(ETHER, 25_000)).toBe(ETHER);
    expect(slashAmount(ETHER, -5)).toBe(0n);
  });
});

describe('SlashingService proposals', () => {
  it('raises one proposal per validator that signed the overturned verdict', async () => {
    const { service } = build();

    const proposals = await service.proposeForOverturnedVerdict(context);

    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      validatorId: V1,
      disputeId: 'dispute-1',
      sessionId: 'session-1',
      verdictId: 'verdict-1',
      stakeAtProposal: (10n * ETHER).toString(),
      amount: ETHER.toString(),
      status: SlashingProposalStatus.PROPOSED,
    });
    expect(proposals[1]).toMatchObject({ validatorId: V2, amount: (20n * ETHER).toString() });
  });

  it('uses the configured slashing fraction', async () => {
    const { service } = build({ config: { 'security.validators.slashingFractionBps': 5000 } });

    const [first] = await service.proposeForOverturnedVerdict(context);

    expect(first.amount).toBe((5n * ETHER).toString());
  });

  it('does not touch any stake until a proposal is approved', async () => {
    const { service, stakes, validators } = build();

    await service.proposeForOverturnedVerdict(context);

    expect(validators.updateStake).not.toHaveBeenCalled();
    expect(stakes[V1]).toBe(10n * ETHER);
  });

  it('skips signers that are not registered validators or hold no stake', async () => {
    const { service } = build({
      stakes: { [V1]: 0n, [V2]: 5n * ETHER },
      signatures: ['self-validator', V1, V2],
    });

    const proposals = await service.proposeForOverturnedVerdict(context);

    expect(proposals.map((p) => p.validatorId)).toEqual([V2]);
  });

  it('raises nothing when the session has no verdict', async () => {
    const { service } = build({ signatures: null });

    expect(await service.proposeForOverturnedVerdict(context)).toEqual([]);
  });

  it('raises nothing when slashing is disabled', async () => {
    const { service, rows } = build({ config: { 'security.validators.slashingEnabled': false } });

    expect(await service.proposeForOverturnedVerdict(context)).toEqual([]);
    expect(rows).toHaveLength(0);
  });

  it('does not duplicate proposals for the same dispute', async () => {
    const { service, rows } = build();
    await service.proposeForOverturnedVerdict(context);

    expect(await service.proposeForOverturnedVerdict(context)).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it('filters the listing', async () => {
    const { service } = build();
    const [first] = await service.proposeForOverturnedVerdict(context);
    await service.reject(first.id, operator);

    expect(await service.findAll()).toHaveLength(2);
    expect(await service.findAll({ status: SlashingProposalStatus.PROPOSED })).toHaveLength(1);
    expect(await service.findAll({ validatorId: V1 })).toEqual([expect.objectContaining({ id: first.id })]);
    expect(await service.findAll({ disputeId: 'other' })).toEqual([]);
  });
});

describe('SlashingService decisions', () => {
  it('reduces the stake when a proposal is approved', async () => {
    const { service, stakes, validators } = build();
    const [first] = await service.proposeForOverturnedVerdict(context);

    const approved = await service.approve(first.id, { ...operator, note: 'confirmed by appeal' });

    expect(validators.updateStake).toHaveBeenCalledWith(V1, (9n * ETHER).toString());
    expect(stakes[V1]).toBe(9n * ETHER);
    expect(approved).toMatchObject({
      status: SlashingProposalStatus.APPROVED,
      decidedBy: 'did:prom:operator-1',
      decisionNote: 'confirmed by appeal',
      amount: ETHER.toString(),
    });
    expect(approved.decidedAt).toBeInstanceOf(Date);
  });

  it('never slashes more than the validator still holds', async () => {
    const { service, stakes } = build();
    const [first] = await service.proposeForOverturnedVerdict(context);
    stakes[V1] = ETHER / 2n; // withdrew most of the stake after the proposal

    const approved = await service.approve(first.id, operator);

    expect(stakes[V1]).toBe(0n);
    expect(approved.amount).toBe((ETHER / 2n).toString());
  });

  it('leaves the stake untouched when a proposal is rejected', async () => {
    const { service, stakes, validators } = build();
    const [first] = await service.proposeForOverturnedVerdict(context);

    const rejected = await service.reject(first.id, operator);

    expect(rejected.status).toBe(SlashingProposalStatus.REJECTED);
    expect(rejected.decisionNote).toBeNull();
    expect(validators.updateStake).not.toHaveBeenCalled();
    expect(stakes[V1]).toBe(10n * ETHER);
  });

  it('decides a proposal only once', async () => {
    const { service, stakes } = build();
    const [first] = await service.proposeForOverturnedVerdict(context);
    await service.approve(first.id, operator);

    await expect(service.approve(first.id, operator)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.reject(first.id, operator)).rejects.toThrow('already approved');
    expect(stakes[V1]).toBe(9n * ETHER);
  });

  it('puts the proposal back when the stake could not be reduced', async () => {
    const { service, validators, rows } = build();
    const [first] = await service.proposeForOverturnedVerdict(context);
    validators.updateStake.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.approve(first.id, operator)).rejects.toThrow('database unavailable');

    expect(rows[0]).toMatchObject({ status: SlashingProposalStatus.PROPOSED, decidedBy: null });
    await expect(service.approve(first.id, operator)).resolves.toMatchObject({
      status: SlashingProposalStatus.APPROVED,
    });
  });

  it('reports an unknown proposal as not found', async () => {
    const { service } = build();

    await expect(service.approve('missing', operator)).rejects.toBeInstanceOf(NotFoundException);
  });
});
