import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { Repository } from 'typeorm';
import { SlashingService } from '../slashing/slashing.service';
import { StakingTier } from '../validators/staking-tiers';
import { ValidatorsService } from '../validators/validators.service';
import { VerdictsService } from '../verdicts/verdicts.service';
import { AppealDecision, AppealVoteChoice, appealVoteMessage } from './appeal-quorum';
import { DisputeAppealsService } from './dispute-appeals.service';
import { AppealStatus, DisputeAppeal, DisputeAppealVote } from './entities/dispute-appeal.entity';
import { Dispute, DisputeOutcome, DisputeStatus } from './entities/dispute.entity';

const RESOLVED_AT = new Date('2026-03-01T12:00:00.000Z');
const hoursAfter = (hours: number) => new Date(RESOLVED_AT.getTime() + hours * 3_600_000);

interface Member {
  id: string;
  wallet: ethers.HDNodeWallet;
}

function memoryRepo<T extends { id?: string }>(prefix: string) {
  const rows: T[] = [];
  const matches = (row: T, where: Partial<T>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof T] === value);
  return {
    rows,
    repo: {
      create: jest.fn((data: Partial<T>) => ({ ...data }) as T),
      save: jest.fn(async (entity: T) => {
        if (!entity.id) {
          entity.id = `${prefix}-${rows.length + 1}`;
          rows.push(entity);
        }
        return entity;
      }),
      find: jest.fn(async ({ where }: { where: Partial<T> }) => rows.filter((row) => matches(row, where))),
      findOneBy: jest.fn(async (where: Partial<T>) => rows.find((row) => matches(row, where)) ?? null),
    },
  };
}

function build(options: {
  outcome?: DisputeOutcome | null;
  status?: DisputeStatus;
  independent?: number;
  config?: Record<string, unknown>;
} = {}) {
  const signers: Member[] = Array.from({ length: 3 }, (_, i) => ({
    id: `signer-${i + 1}`,
    wallet: ethers.Wallet.createRandom(),
  }));
  const independents: Member[] = Array.from({ length: options.independent ?? 7 }, (_, i) => ({
    id: `panelist-${i + 1}`,
    wallet: ethers.Wallet.createRandom(),
  }));
  const everyone = [...signers, ...independents];

  const dispute = {
    id: 'dispute-1',
    sessionId: 'session-1',
    status: options.status ?? DisputeStatus.RESOLVED,
    outcome: options.outcome === undefined ? DisputeOutcome.OVERTURNED : options.outcome,
    resolution: 'independent re-verification disagrees',
    resolvedAt: RESOLVED_AT,
  } as Dispute;

  const appeals = memoryRepo<DisputeAppeal>('appeal');
  const votes = memoryRepo<DisputeAppealVote>('vote');
  const disputeRepo = {
    findOneBy: jest.fn(async ({ id }: { id: string }) => (id === dispute.id ? dispute : null)),
    save: jest.fn(async (entity: Dispute) => entity),
  };
  const validators = {
    findEligible: jest.fn(async () =>
      everyone.map((member) => ({ id: member.id, tier: StakingTier.BRONZE, weight: 1 })),
    ),
    findOne: jest.fn(async (id: string) => {
      const member = everyone.find((m) => m.id === id);
      if (!member) throw new NotFoundException(`Validator ${id} not found`);
      return { id, address: member.wallet.address };
    }),
  };
  const verdicts = {
    findOptionalBySessionId: jest.fn(async () => ({
      id: 'verdict-1',
      signatures: signers.map((signer) => signer.id),
    })),
  };
  const slashing = {
    proposeForOverturnedVerdict: jest.fn(async () => []),
    rejectPendingForDispute: jest.fn(async () => 0),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => options.config?.[key] ?? fallback),
  };

  const service = new DisputeAppealsService(
    appeals.repo as unknown as Repository<DisputeAppeal>,
    votes.repo as unknown as Repository<DisputeAppealVote>,
    disputeRepo as unknown as Repository<Dispute>,
    validators as unknown as ValidatorsService,
    verdicts as unknown as VerdictsService,
    slashing as unknown as SlashingService,
    config as unknown as ConfigService,
  );

  const open = (now = hoursAfter(1)) =>
    service.open('dispute-1', { appellant: 'did:prom:agent-b', reason: 'new evidence' }, now);

  const cast = async (member: Member, vote: AppealVoteChoice, now = hoursAfter(2)) => {
    const appealId = appeals.rows[0].id;
    const signature = await member.wallet.signMessage(appealVoteMessage(appealId, vote));
    return service.vote('dispute-1', { validatorId: member.id, vote, signature }, now);
  };

  const panelists = () => independents.filter((m) => appeals.rows[0].panel.includes(m.id));

  return { service, dispute, signers, independents, slashing, appeals, votes, open, cast, panelists };
}

describe('DisputeAppealsService.open', () => {
  it('draws an expanded panel that excludes the verdict signers', async () => {
    const { open, signers, dispute } = build();

    const appeal = await open();

    expect(appeal.panel).toHaveLength(7);
    expect(new Set(appeal.panel).size).toBe(7);
    for (const signer of signers) expect(appeal.panel).not.toContain(signer.id);
    expect(appeal).toMatchObject({
      disputeId: 'dispute-1',
      appellant: 'did:prom:agent-b',
      originalOutcome: DisputeOutcome.OVERTURNED,
      quorum: 5,
      status: AppealStatus.OPEN,
      decision: null,
      votes: [],
    });
    expect(appeal.votingDeadline).toEqual(hoursAfter(1 + 48));
    expect(dispute.status).toBe(DisputeStatus.APPEALED);
  });

  it('scales the panel with the configured multiplier', async () => {
    const { open } = build({ independent: 12, config: { APPEAL_PANEL_MULTIPLIER: 3 } });

    const appeal = await open();

    expect(appeal.panel).toHaveLength(10);
    expect(appeal.quorum).toBe(7);
  });

  it('works with a smaller panel as long as it outnumbers the original committee', async () => {
    const { open } = build({ independent: 4 });

    const appeal = await open();

    expect(appeal.panel).toHaveLength(4);
    expect(appeal.quorum).toBe(3);
  });

  it('refuses an appeal that the available validators cannot expand', async () => {
    const { open, dispute } = build({ independent: 3 });

    await expect(open()).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(dispute.status).toBe(DisputeStatus.RESOLVED);
  });

  it('allows a single appeal round per dispute', async () => {
    const { open } = build();
    await open();

    await expect(open()).rejects.toThrow('already been appealed');
  });

  it('refuses disputes that are unresolved or have no recorded outcome', async () => {
    await expect(build({ status: DisputeStatus.OPEN }).open()).rejects.toThrow('not resolved yet');
    await expect(build({ outcome: null }).open()).rejects.toThrow('no recorded outcome');
  });

  it('enforces the appeal window', async () => {
    await expect(build().open(hoursAfter(72))).resolves.toBeDefined();
    await expect(build().open(hoursAfter(72.01))).rejects.toThrow('appeal window');
    await expect(build({ config: { APPEAL_WINDOW_HOURS: 1 } }).open(hoursAfter(2))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('reports an unknown dispute as not found', async () => {
    const { service } = build();

    await expect(
      service.open('missing', { appellant: 'did:prom:agent-b', reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findByDispute('dispute-1')).rejects.toThrow('has no appeal');
  });
});

describe('DisputeAppealsService voting', () => {
  it('reverses an overturned verdict at the quorum and withdraws pending slashing', async () => {
    const { open, cast, panelists, dispute, slashing } = build();
    await open();
    const panel = panelists();

    for (const member of panel.slice(0, 4)) {
      const view = await cast(member, AppealVoteChoice.OVERTURN);
      expect(view.status).toBe(AppealStatus.OPEN);
    }
    const decided = await cast(panel[4], AppealVoteChoice.OVERTURN);

    expect(decided).toMatchObject({ status: AppealStatus.DECIDED, decision: AppealDecision.REVERSED });
    expect(decided.tally).toMatchObject({ overturn: 5, uphold: 0, quorum: 5 });
    expect(dispute.status).toBe(DisputeStatus.RESOLVED);
    expect(dispute.outcome).toBe(DisputeOutcome.UPHELD);
    expect(dispute.resolution).toContain('resolution reversed by the appeal panel');
    expect(slashing.rejectPendingForDispute).toHaveBeenCalledWith(
      'dispute-1',
      `appeal:${decided.id}`,
      'Verdict reinstated on appeal',
    );
    expect(slashing.proposeForOverturnedVerdict).not.toHaveBeenCalled();
  });

  it('raises slashing proposals when an upheld verdict falls on appeal', async () => {
    const { open, cast, panelists, dispute, slashing } = build({ outcome: DisputeOutcome.UPHELD });
    await open();

    for (const member of panelists().slice(0, 5)) await cast(member, AppealVoteChoice.OVERTURN);

    expect(dispute.outcome).toBe(DisputeOutcome.OVERTURNED);
    expect(slashing.proposeForOverturnedVerdict).toHaveBeenCalledWith(
      expect.objectContaining({ disputeId: 'dispute-1', sessionId: 'session-1' }),
    );
    expect(slashing.rejectPendingForDispute).not.toHaveBeenCalled();
  });

  it('upholds the resolution once the quorum is out of reach', async () => {
    const { open, cast, panelists, dispute, slashing } = build();
    await open();
    const panel = panelists();

    await cast(panel[0], AppealVoteChoice.OVERTURN);
    await cast(panel[1], AppealVoteChoice.UPHOLD);
    await cast(panel[2], AppealVoteChoice.UPHOLD);
    const decided = await cast(panel[3], AppealVoteChoice.UPHOLD);

    expect(decided.decision).toBe(AppealDecision.UPHELD);
    expect(dispute.status).toBe(DisputeStatus.RESOLVED);
    expect(dispute.outcome).toBe(DisputeOutcome.OVERTURNED);
    expect(dispute.resolution).toBe('independent re-verification disagrees');
    expect(slashing.rejectPendingForDispute).not.toHaveBeenCalled();
    expect(slashing.proposeForOverturnedVerdict).not.toHaveBeenCalled();
  });

  it('rejects votes from outside the panel, including the verdict signers', async () => {
    const { open, cast, signers } = build();
    await open();

    await expect(cast(signers[0], AppealVoteChoice.UPHOLD)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a vote signed for the other choice or by another key', async () => {
    const { open, service, panelists, appeals, votes } = build();
    await open();
    const [member, other] = panelists();
    const appealId = appeals.rows[0].id;

    const flipped = await member.wallet.signMessage(appealVoteMessage(appealId, AppealVoteChoice.UPHOLD));
    await expect(
      service.vote(
        'dispute-1',
        { validatorId: member.id, vote: AppealVoteChoice.OVERTURN, signature: flipped },
        hoursAfter(2),
      ),
    ).rejects.toThrow('not signed by the validator address');

    const borrowed = await other.wallet.signMessage(appealVoteMessage(appealId, AppealVoteChoice.OVERTURN));
    await expect(
      service.vote(
        'dispute-1',
        { validatorId: member.id, vote: AppealVoteChoice.OVERTURN, signature: borrowed },
        hoursAfter(2),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(votes.rows).toHaveLength(0);
  });

  it('accepts one vote per panel member', async () => {
    const { open, cast, panelists } = build();
    await open();
    const [member] = panelists();
    await cast(member, AppealVoteChoice.OVERTURN);

    await expect(cast(member, AppealVoteChoice.UPHOLD)).rejects.toThrow('already voted');
  });

  it('rejects votes after the deadline or after the decision', async () => {
    const { open, cast, panelists } = build();
    await open();
    const panel = panelists();

    await expect(cast(panel[0], AppealVoteChoice.OVERTURN, hoursAfter(50))).rejects.toThrow(
      'has closed',
    );
    for (const member of panel.slice(0, 3)) await cast(member, AppealVoteChoice.UPHOLD);
    await expect(cast(panel[5], AppealVoteChoice.OVERTURN)).rejects.toThrow('already decided');
  });
});

describe('DisputeAppealsService.close', () => {
  it('cannot close while the result is open and the deadline has not passed', async () => {
    const { open, cast, panelists, service } = build();
    await open();
    await cast(panelists()[0], AppealVoteChoice.OVERTURN);

    await expect(service.close('dispute-1', hoursAfter(10))).rejects.toThrow('still open');
  });

  it('upholds the resolution at the deadline when the quorum was not reached', async () => {
    const { open, cast, panelists, service, dispute } = build();
    await open();
    for (const member of panelists().slice(0, 4)) await cast(member, AppealVoteChoice.OVERTURN);

    const closed = await service.close('dispute-1', hoursAfter(50));

    expect(closed).toMatchObject({ status: AppealStatus.DECIDED, decision: AppealDecision.UPHELD });
    expect(closed.decidedAt).toEqual(hoursAfter(50));
    expect(dispute.status).toBe(DisputeStatus.RESOLVED);
    expect(dispute.outcome).toBe(DisputeOutcome.OVERTURNED);
  });

  it('is idempotent once decided', async () => {
    const { open, service, slashing } = build();
    await open();

    const first = await service.close('dispute-1', hoursAfter(50));
    const second = await service.close('dispute-1', hoursAfter(60));

    expect(second).toEqual(first);
    expect(slashing.rejectPendingForDispute).not.toHaveBeenCalled();
  });
});
