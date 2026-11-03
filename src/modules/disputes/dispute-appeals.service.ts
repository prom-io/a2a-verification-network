import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SlashingService } from '../slashing/slashing.service';
import { selectWeighted } from '../validators/staking-tiers';
import { ValidatorsService } from '../validators/validators.service';
import { VerdictsService } from '../verdicts/verdicts.service';
import {
  AppealDecision,
  AppealTally,
  appealPanelSize,
  decisionAtDeadline,
  recoverAppealVoter,
  reversalQuorum,
  tallyAppeal,
} from './appeal-quorum';
import { CastAppealVoteDto, OpenAppealDto } from './dto/appeal.dto';
import { AppealStatus, DisputeAppeal, DisputeAppealVote } from './entities/dispute-appeal.entity';
import { Dispute, DisputeOutcome, DisputeStatus } from './entities/dispute.entity';

/** Committee size assumed when the disputed session has no recorded signers. */
const BASELINE_COMMITTEE_SIZE = 3;
const HOUR_MS = 60 * 60 * 1000;

export interface AppealView extends DisputeAppeal {
  votes: Array<Pick<DisputeAppealVote, 'validatorId' | 'vote' | 'castAt'>>;
  tally: AppealTally;
}

/**
 * One appeal round per dispute.
 *
 * A resolution can be challenged once, within the appeal window. The appeal is
 * decided by a panel larger than the committee that issued the verdict, drawn
 * by stake weight from validators that did not sign it, and reversing the
 * resolution takes two thirds of that panel.
 */
@Injectable()
export class DisputeAppealsService {
  private readonly logger = new Logger(DisputeAppealsService.name);

  constructor(
    @InjectRepository(DisputeAppeal)
    private readonly appealRepo: Repository<DisputeAppeal>,
    @InjectRepository(DisputeAppealVote)
    private readonly voteRepo: Repository<DisputeAppealVote>,
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    private readonly validatorsService: ValidatorsService,
    private readonly verdictsService: VerdictsService,
    private readonly slashingService: SlashingService,
    private readonly configService: ConfigService,
  ) {}

  async open(disputeId: string, dto: OpenAppealDto, now = new Date()): Promise<AppealView> {
    const dispute = await this.dispute(disputeId);
    if (await this.appealRepo.findOneBy({ disputeId })) {
      throw new ConflictException(`Dispute ${disputeId} has already been appealed`);
    }
    if (dispute.status !== DisputeStatus.RESOLVED) {
      throw new ConflictException(`Dispute ${disputeId} is not resolved yet`);
    }
    if (!dispute.outcome) {
      throw new ConflictException(`Dispute ${disputeId} has no recorded outcome to appeal`);
    }
    const windowMs = Number(this.configService.get('APPEAL_WINDOW_HOURS', 72)) * HOUR_MS;
    if (dispute.resolvedAt && now.getTime() > new Date(dispute.resolvedAt).getTime() + windowMs) {
      throw new ConflictException(`The appeal window for dispute ${disputeId} has closed`);
    }

    // Validators that signed the disputed verdict do not review it.
    const verdict = await this.verdictsService.findOptionalBySessionId(dispute.sessionId);
    const signers = new Set(verdict?.signatures ?? []);
    const committeeSize = Math.max(signers.size, BASELINE_COMMITTEE_SIZE);
    const candidates = (await this.validatorsService.findEligible()).filter(
      (candidate) => !signers.has(candidate.id),
    );
    const panel = selectWeighted(
      candidates,
      appealPanelSize(committeeSize, Number(this.configService.get('APPEAL_PANEL_MULTIPLIER', 2))),
      `appeal:${disputeId}`,
    );
    if (panel.length <= committeeSize) {
      throw new UnprocessableEntityException(
        `An appeal needs more than ${committeeSize} staked validators that did not sign the verdict; ` +
          `${panel.length} available`,
      );
    }

    const votingMs = Number(this.configService.get('APPEAL_VOTING_HOURS', 48)) * HOUR_MS;
    const appeal = await this.appealRepo.save(
      this.appealRepo.create({
        disputeId,
        appellant: dto.appellant,
        reason: dto.reason,
        originalOutcome: dispute.outcome,
        panel,
        quorum: reversalQuorum(panel.length),
        status: AppealStatus.OPEN,
        decision: null,
        votingDeadline: new Date(now.getTime() + votingMs),
        decidedAt: null,
      }),
    );
    dispute.status = DisputeStatus.APPEALED;
    await this.disputeRepo.save(dispute);

    this.logger.log(
      `Dispute ${disputeId} appealed by ${dto.appellant}: panel of ${panel.length}, ` +
        `${appeal.quorum} votes to reverse`,
    );
    return this.view(appeal);
  }

  async vote(disputeId: string, dto: CastAppealVoteDto, now = new Date()): Promise<AppealView> {
    const appeal = await this.appeal(disputeId);
    if (appeal.status !== AppealStatus.OPEN) {
      throw new ConflictException(`The appeal of dispute ${disputeId} is already decided`);
    }
    if (now > appeal.votingDeadline) {
      throw new ConflictException(`Voting on the appeal of dispute ${disputeId} has closed`);
    }
    if (!appeal.panel.includes(dto.validatorId)) {
      throw new ForbiddenException(`Validator ${dto.validatorId} is not on the appeal panel`);
    }

    const validator = await this.validatorsService.findOne(dto.validatorId);
    let signer: string;
    try {
      signer = recoverAppealVoter(appeal.id, dto.vote, dto.signature);
    } catch {
      throw new BadRequestException('signature is not a valid signature of the appeal vote');
    }
    if (signer.toLowerCase() !== validator.address.toLowerCase()) {
      throw new ForbiddenException('Vote is not signed by the validator address');
    }

    if (await this.voteRepo.findOneBy({ appealId: appeal.id, validatorId: dto.validatorId })) {
      throw new ConflictException(`Validator ${dto.validatorId} has already voted on this appeal`);
    }
    await this.voteRepo.save(
      this.voteRepo.create({ appealId: appeal.id, validatorId: dto.validatorId, vote: dto.vote }),
    );

    // Close as soon as the remaining votes cannot change the result.
    const { tally } = await this.view(appeal);
    if (tally.decision) await this.decide(appeal, tally.decision, now);
    return this.view(appeal);
  }

  /**
   * Closes an appeal whose voting deadline has passed. Panel members that did
   * not vote count for the existing resolution.
   */
  async close(disputeId: string, now = new Date()): Promise<AppealView> {
    const appeal = await this.appeal(disputeId);
    if (appeal.status === AppealStatus.DECIDED) return this.view(appeal);

    const { tally } = await this.view(appeal);
    if (!tally.decision && now <= appeal.votingDeadline) {
      throw new ConflictException(`Voting on the appeal of dispute ${disputeId} is still open`);
    }
    await this.decide(appeal, tally.decision ?? decisionAtDeadline(tally), now);
    return this.view(appeal);
  }

  async findByDispute(disputeId: string): Promise<AppealView> {
    return this.view(await this.appeal(disputeId));
  }

  private async decide(appeal: DisputeAppeal, decision: AppealDecision, now: Date): Promise<void> {
    const dispute = await this.dispute(appeal.disputeId);

    appeal.status = AppealStatus.DECIDED;
    appeal.decision = decision;
    appeal.decidedAt = now;
    await this.appealRepo.save(appeal);

    dispute.status = DisputeStatus.RESOLVED;
    if (decision === AppealDecision.REVERSED) {
      dispute.outcome =
        appeal.originalOutcome === DisputeOutcome.OVERTURNED
          ? DisputeOutcome.UPHELD
          : DisputeOutcome.OVERTURNED;
      dispute.resolution = `${dispute.resolution ?? ''}\n[appeal ${appeal.id}] resolution reversed by the appeal panel`.trim();
    }
    await this.disputeRepo.save(dispute);
    this.logger.log(`Appeal of dispute ${dispute.id} decided: ${decision}`);

    if (decision !== AppealDecision.REVERSED) return;
    if (dispute.outcome === DisputeOutcome.OVERTURNED) {
      // The verdict stood after the dispute and falls on appeal.
      await this.slashingService.proposeForOverturnedVerdict({
        disputeId: dispute.id,
        sessionId: dispute.sessionId,
        reason: `Verdict overturned on appeal ${appeal.id} of dispute ${dispute.id}`,
      });
    } else {
      // The verdict is reinstated; proposals raised against its signers that
      // have not been executed yet are withdrawn.
      await this.slashingService.rejectPendingForDispute(
        dispute.id,
        `appeal:${appeal.id}`,
        'Verdict reinstated on appeal',
      );
    }
  }

  private async dispute(disputeId: string): Promise<Dispute> {
    const dispute = await this.disputeRepo.findOneBy({ id: disputeId });
    if (!dispute) throw new NotFoundException(`Dispute ${disputeId} not found`);
    return dispute;
  }

  private async appeal(disputeId: string): Promise<DisputeAppeal> {
    const appeal = await this.appealRepo.findOneBy({ disputeId });
    if (!appeal) throw new NotFoundException(`Dispute ${disputeId} has no appeal`);
    return appeal;
  }

  private async view(appeal: DisputeAppeal): Promise<AppealView> {
    const votes = await this.voteRepo.find({
      where: { appealId: appeal.id },
      order: { castAt: 'ASC' },
    });
    return {
      ...appeal,
      votes: votes.map(({ validatorId, vote, castAt }) => ({ validatorId, vote, castAt })),
      tally: tallyAppeal(
        votes.map((vote) => vote.vote),
        appeal.panel.length,
      ),
    };
  }
}
