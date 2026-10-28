import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ValidatorsService } from '../validators/validators.service';
import { parseStake } from '../validators/staking-tiers';
import { VerdictsService } from '../verdicts/verdicts.service';
import { DecideSlashingDto } from './dto/decide-slashing.dto';
import { SlashingProposal, SlashingProposalStatus } from './entities/slashing-proposal.entity';

const BPS_DENOMINATOR = 10_000n;

/** Share of `stake` expressed in basis points, rounded down to whole wei. */
export function slashAmount(stake: bigint, fractionBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.trunc(fractionBps))));
  return (stake * bps) / BPS_DENOMINATOR;
}

export interface OverturnedVerdictContext {
  disputeId: string;
  sessionId: string;
  reason: string;
}

@Injectable()
export class SlashingService {
  private readonly logger = new Logger(SlashingService.name);

  constructor(
    @InjectRepository(SlashingProposal)
    private readonly proposalRepo: Repository<SlashingProposal>,
    private readonly validatorsService: ValidatorsService,
    private readonly verdictsService: VerdictsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Raises one proposal per validator that signed the verdict a dispute has
   * just overturned. Proposals, not slashes: a dispute outcome can itself be
   * appealed, and stake that has been taken cannot be handed back as easily as
   * a pending proposal can be rejected.
   */
  async proposeForOverturnedVerdict(context: OverturnedVerdictContext): Promise<SlashingProposal[]> {
    if (!this.configService.get<boolean>('security.validators.slashingEnabled', true)) {
      this.logger.log(`Slashing disabled; no proposals for dispute ${context.disputeId}`);
      return [];
    }

    const verdict = await this.verdictsService.findOptionalBySessionId(context.sessionId);
    if (!verdict) {
      this.logger.warn(
        `Dispute ${context.disputeId} overturned session ${context.sessionId}, which has no verdict`,
      );
      return [];
    }

    const fractionBps = Number(
      this.configService.get('security.validators.slashingFractionBps', 1000),
    );
    // Signatures can hold placeholders (the service acting as its own
    // validator); only registered validators have a stake to slash.
    const signers = await this.validatorsService.findByIds(verdict.signatures);
    const existing = await this.proposalRepo.findBy({ disputeId: context.disputeId });
    const alreadyProposed = new Set(existing.map((proposal) => proposal.validatorId));

    const created: SlashingProposal[] = [];
    for (const validator of signers) {
      if (alreadyProposed.has(validator.id)) continue;
      const stake = parseStake(validator.stake);
      const amount = slashAmount(stake, fractionBps);
      if (amount === 0n) continue;

      created.push(
        await this.proposalRepo.save(
          this.proposalRepo.create({
            validatorId: validator.id,
            disputeId: context.disputeId,
            sessionId: context.sessionId,
            verdictId: verdict.id,
            reason: context.reason,
            stakeAtProposal: stake.toString(),
            amount: amount.toString(),
            status: SlashingProposalStatus.PROPOSED,
          }),
        ),
      );
    }

    this.logger.log(
      `Dispute ${context.disputeId}: ${created.length} slashing proposal(s) for verdict ${verdict.id}`,
    );
    return created;
  }

  async findAll(filter: {
    status?: SlashingProposalStatus;
    validatorId?: string;
    disputeId?: string;
  } = {}): Promise<SlashingProposal[]> {
    const where: FindOptionsWhere<SlashingProposal> = {};
    if (filter.status) where.status = filter.status;
    if (filter.validatorId) where.validatorId = filter.validatorId;
    if (filter.disputeId) where.disputeId = filter.disputeId;
    return this.proposalRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<SlashingProposal> {
    const proposal = await this.proposalRepo.findOneBy({ id });
    if (!proposal) throw new NotFoundException(`Slashing proposal ${id} not found`);
    return proposal;
  }

  /**
   * Applies the slash to the validator's recorded stake, which also moves it
   * to the tier the reduced stake qualifies for. The amount is capped at what
   * the validator still holds: stake may have shrunk since the proposal.
   */
  async approve(id: string, dto: DecideSlashingDto): Promise<SlashingProposal> {
    const proposal = await this.decide(id, SlashingProposalStatus.APPROVED, dto);

    try {
      const validator = await this.validatorsService.findOne(proposal.validatorId);
      const stake = parseStake(validator.stake);
      const amount = parseStake(proposal.amount);
      const slashed = amount > stake ? stake : amount;
      await this.validatorsService.updateStake(validator.id, (stake - slashed).toString());

      proposal.amount = slashed.toString();
      this.logger.warn(
        `Validator ${validator.id} slashed by ${slashed} wei (proposal ${id}, by ${dto.decidedBy})`,
      );
      return await this.proposalRepo.save(proposal);
    } catch (error) {
      // The stake was not reduced, so the proposal must not read as executed.
      await this.proposalRepo.update(
        { id },
        { status: SlashingProposalStatus.PROPOSED, decidedAt: null, decidedBy: null, decisionNote: null },
      );
      throw error;
    }
  }

  async reject(id: string, dto: DecideSlashingDto): Promise<SlashingProposal> {
    return this.decide(id, SlashingProposalStatus.REJECTED, dto);
  }

  /**
   * Moves a proposal out of `proposed` with a conditional update, so two
   * operators approving at the same moment cannot both slash the validator.
   */
  private async decide(
    id: string,
    status: SlashingProposalStatus,
    dto: DecideSlashingDto,
  ): Promise<SlashingProposal> {
    const current = await this.findOne(id);
    const result = await this.proposalRepo.update(
      { id, status: SlashingProposalStatus.PROPOSED },
      {
        status,
        decidedAt: new Date(),
        decidedBy: dto.decidedBy,
        decisionNote: dto.note ?? null,
      },
    );
    if (!result.affected) {
      throw new ConflictException(`Slashing proposal ${id} is already ${current.status}`);
    }
    return this.findOne(id);
  }
}
