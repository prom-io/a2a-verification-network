import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoliciesService } from '../policies/policies.service';
import { ReputationService } from '../reputation/reputation.service';
import { StakingTier } from '../validators/staking-tiers';
import { ValidatorsService } from '../validators/validators.service';
import { EligibilityService } from './eligibility.service';

const POLICY = '0e3a2f1c-6b7d-4c8e-9f10-2a3b4c5d6e7f';

function build(minReputationScore: string | null, scores: Record<string, number>) {
  const pool = [
    { id: 'veteran', tier: StakingTier.GOLD, weight: 4, stake: '20' },
    { id: 'average', tier: StakingTier.SILVER, weight: 2, stake: '5' },
    { id: 'newcomer', tier: StakingTier.BRONZE, weight: 1, stake: '1' },
    { id: 'offender', tier: StakingTier.PLATINUM, weight: 8, stake: '100' },
  ];
  const validators = { findEligible: jest.fn(async () => pool) };
  const reputation = {
    effectiveScores: jest.fn(async (ids: string[]) =>
      new Map(ids.filter((id) => id in scores).map((id) => [id, scores[id]])),
    ),
  };
  const policy = minReputationScore === null ? null : { id: POLICY, minReputationScore };
  const policies = {
    findById: jest.fn(async () => policy),
    findOne: jest.fn(async (id: string) => {
      if (!policy) throw new NotFoundException(`Policy ${id} not found`);
      return policy;
    }),
  };
  const config = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };
  const service = new EligibilityService(
    validators as unknown as ValidatorsService,
    reputation as unknown as ReputationService,
    policies as unknown as PoliciesService,
    config as unknown as ConfigService,
  );
  return { service, reputation, policies };
}

const SCORES = { veteran: 0.93, average: 0.71, offender: 0.32 };

describe('EligibilityService.candidatesFor', () => {
  it('lets every staked validator in when the policy sets no minimum', async () => {
    const { service, reputation } = build('0.0000', SCORES);

    const result = await service.candidatesFor(POLICY);

    expect(result.minScore).toBe(0);
    expect(result.candidates.map((c) => c.id)).toEqual(['veteran', 'average', 'newcomer', 'offender']);
    expect(reputation.effectiveScores).not.toHaveBeenCalled();
  });

  it('turns away validators below the minimum and keeps unrated ones at neutral', async () => {
    const { service } = build('0.5000', SCORES);

    const result = await service.candidatesFor(POLICY);

    expect(result).toEqual({
      minScore: 0.5,
      excluded: 1,
      candidates: [
        { id: 'veteran', tier: StakingTier.GOLD, weight: 4, stake: '20' },
        { id: 'average', tier: StakingTier.SILVER, weight: 2, stake: '5' },
        { id: 'newcomer', tier: StakingTier.BRONZE, weight: 1, stake: '1' },
      ],
    });
  });

  it('keeps unrated validators out of a policy stricter than neutral', async () => {
    const { service } = build('0.7000', SCORES);

    expect((await service.candidatesFor(POLICY)).candidates.map((c) => c.id)).toEqual([
      'veteran',
      'average',
    ]);
  });

  it('does not gate jobs whose policy is unknown here', async () => {
    const { service } = build(null, SCORES);

    const result = await service.candidatesFor('not-a-policy');

    expect(result.minScore).toBe(0);
    expect(result.candidates).toHaveLength(4);
  });
});

describe('EligibilityService.report', () => {
  it('lists every staked validator, best score first, with the verdict of the gate', async () => {
    const { service } = build('0.7000', SCORES);

    const report = await service.report(POLICY);

    expect(report).toMatchObject({ policyId: POLICY, minReputationScore: 0.7, qualifying: 2 });
    expect(report.validators.map(({ id, score, qualifies }) => [id, score, qualifies])).toEqual([
      ['veteran', 0.93, true],
      ['average', 0.71, true],
      ['newcomer', 0.5, false],
      ['offender', 0.32, false],
    ]);
  });

  it('reports an unknown policy as not found', async () => {
    const { service } = build(null, SCORES);

    await expect(service.report(POLICY)).rejects.toBeInstanceOf(NotFoundException);
  });
});
