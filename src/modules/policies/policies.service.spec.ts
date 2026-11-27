import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { VerificationClass, VerificationPolicy } from './entities/verification-policy.entity';
import { PoliciesService } from './policies.service';

const ID = '0e3a2f1c-6b7d-4c8e-9f10-2a3b4c5d6e7f';

function build() {
  const rows: VerificationPolicy[] = [];
  const repo = {
    create: jest.fn((data: Partial<VerificationPolicy>) => ({ ...data }) as VerificationPolicy),
    save: jest.fn(async (policy: VerificationPolicy) => {
      policy.id = policy.id ?? ID;
      rows.push(policy);
      return policy;
    }),
    find: jest.fn(async () => rows),
    findOneBy: jest.fn(async ({ id }: { id: string }) => rows.find((row) => row.id === id) ?? null),
  };
  const service = new PoliciesService(repo as unknown as Repository<VerificationPolicy>);
  return { service, repo };
}

const dto = {
  name: 'code review',
  verificationClass: VerificationClass.CLASS_1,
  selectionRule: {},
  verificationMethod: 'llm-judge',
  quorumThreshold: 2,
  price: '0',
};

describe('PoliciesService', () => {
  it('stores the reputation minimum with four decimals, none by default', async () => {
    const { service } = build();

    expect((await service.create(dto)).minReputationScore).toBe('0.0000');
    expect((await service.create({ ...dto, minReputationScore: 0.75 })).minReputationScore).toBe('0.7500');
  });

  it('finds a policy by id, or null without querying for an impossible id', async () => {
    const { service, repo } = build();
    await service.create(dto);

    expect(await service.findById(ID)).toMatchObject({ name: 'code review' });
    expect(await service.findById('a7e0d6c4-1111-4222-8333-444455556666')).toBeNull();
    repo.findOneBy.mockClear();
    expect(await service.findById('policy-1')).toBeNull();
    expect(repo.findOneBy).not.toHaveBeenCalled();
  });

  it('throws for a missing policy in findOne', async () => {
    const { service } = build();

    await expect(service.findOne(ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
