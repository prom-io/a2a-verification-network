import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { SlashingService } from '../slashing/slashing.service';
import { DisputesService } from './disputes.service';
import { Dispute, DisputeOutcome, DisputeStatus } from './entities/dispute.entity';

function build() {
  const rows: Dispute[] = [];
  const repo = {
    create: jest.fn((data: Partial<Dispute>) => ({ ...data }) as Dispute),
    save: jest.fn(async (dispute: Dispute) => {
      if (!dispute.id) {
        dispute.id = `dispute-${rows.length + 1}`;
        rows.push(dispute);
      }
      return dispute;
    }),
    findOneBy: jest.fn(async ({ id }: { id: string }) => rows.find((row) => row.id === id) ?? null),
  };
  const slashing = { proposeForOverturnedVerdict: jest.fn().mockResolvedValue([]) };
  const service = new DisputesService(
    repo as unknown as Repository<Dispute>,
    slashing as unknown as SlashingService,
  );
  return { service, slashing };
}

const open = {
  sessionId: 'session-1',
  reason: 'verdict does not match the delivered work',
  initiator: 'did:prom:agent-a',
};

describe('DisputesService', () => {
  it('opens a dispute in the open state', async () => {
    const { service } = build();

    expect(await service.open(open)).toMatchObject({ ...open, status: DisputeStatus.OPEN });
  });

  it('records the resolution and its outcome', async () => {
    const { service } = build();
    const dispute = await service.open(open);

    const resolved = await service.resolve(dispute.id, {
      resolution: 'verdict upheld after re-verification',
      outcome: DisputeOutcome.UPHELD,
    });

    expect(resolved).toMatchObject({
      status: DisputeStatus.RESOLVED,
      resolution: 'verdict upheld after re-verification',
      outcome: DisputeOutcome.UPHELD,
    });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
  });

  it('raises slashing proposals when the verdict is overturned', async () => {
    const { service, slashing } = build();
    const dispute = await service.open(open);

    await service.resolve(dispute.id, {
      resolution: 'result hash does not match the artifact',
      outcome: DisputeOutcome.OVERTURNED,
    });

    expect(slashing.proposeForOverturnedVerdict).toHaveBeenCalledTimes(1);
    expect(slashing.proposeForOverturnedVerdict).toHaveBeenCalledWith({
      disputeId: dispute.id,
      sessionId: 'session-1',
      reason: expect.stringContaining('result hash does not match the artifact'),
    });
  });

  it.each([[DisputeOutcome.UPHELD], [undefined]])(
    'does not propose slashing for outcome %s',
    async (outcome) => {
      const { service, slashing } = build();
      const dispute = await service.open(open);

      const resolved = await service.resolve(dispute.id, { resolution: 'closed', outcome });

      expect(resolved.outcome).toBe(outcome ?? null);
      expect(slashing.proposeForOverturnedVerdict).not.toHaveBeenCalled();
    },
  );

  it('refuses to resolve a dispute twice', async () => {
    const { service, slashing } = build();
    const dispute = await service.open(open);
    await service.resolve(dispute.id, { resolution: 'first' });

    await expect(
      service.resolve(dispute.id, { resolution: 'second', outcome: DisputeOutcome.OVERTURNED }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(slashing.proposeForOverturnedVerdict).not.toHaveBeenCalled();
  });

  it('reports an unknown dispute as not found', async () => {
    const { service } = build();

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
