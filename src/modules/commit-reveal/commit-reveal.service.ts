import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobsService } from '../jobs/jobs.service';
import {
  JobStatus,
  VerdictMode,
  VerificationJob,
} from '../jobs/entities/verification-job.entity';
import { ValidatorsService } from '../validators/validators.service';
import { VerdictsService } from '../verdicts/verdicts.service';
import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import { ReputationService } from '../reputation/reputation.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { selectWeighted } from '../validators/staking-tiers';
import { VerdictCommitment } from './entities/verdict-commitment.entity';
import { CommitVerdictDto } from './dto/commit-verdict.dto';
import { RevealVerdictDto } from './dto/reveal-verdict.dto';
import { Tally, computeCommitHash, recoverCommitSigner, tallyReveals } from './commitment';
import {
  DEFAULT_THRESHOLD_BPS,
  QuorumRules,
  QuorumWeighting,
  WeightedTally,
  requiredWeight,
  tallyWeighted,
} from './weighted-quorum';

export type CommitRevealPhase = 'commit' | 'reveal' | 'finalized';

export interface CommitmentView {
  validatorId: string;
  committedAt: Date;
  revealed: boolean;
  outcome: VerdictOutcome | null;
  revealedAt: Date | null;
}

export interface RoundStatus {
  jobId: string;
  phase: CommitRevealPhase;
  jobStatus: JobStatus;
  committee: string[];
  commitDeadline: Date | null;
  revealDeadline: Date | null;
  /** How often the committee was widened after a round without a quorum. */
  expansions: number;
  commitments: CommitmentView[];
  tally: RoundTally;
}

/**
 * Vote counts per outcome, with the decision taken by the weighted tally:
 * `outcome` and `supporters` come from `weighted`, `quorum` is the number of
 * votes the threshold amounts to when every vote weighs the same.
 */
export type RoundTally = Tally & { weighted: WeightedTally };

/**
 * Two-phase voting for a job's committee.
 *
 * Validators first publish a hash of their vote and only reveal the vote once
 * every commitment is in (or the commit deadline has passed). Nobody can copy
 * another validator's verdict instead of doing the verification, because at the
 * time a vote becomes visible it can no longer be changed.
 */
@Injectable()
export class CommitRevealService {
  private readonly logger = new Logger(CommitRevealService.name);

  constructor(
    @InjectRepository(VerdictCommitment)
    private readonly commitmentRepo: Repository<VerdictCommitment>,
    private readonly jobsService: JobsService,
    private readonly validatorsService: ValidatorsService,
    private readonly verdictsService: VerdictsService,
    private readonly reputationService: ReputationService,
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService,
  ) {}

  async commit(jobId: string, dto: CommitVerdictDto, now = new Date()): Promise<CommitmentView> {
    const { job, commitments } = await this.loadRound(jobId);
    const phase = this.phaseOf(job, commitments, now);
    if (phase !== 'commit') {
      throw new ConflictException(`Commit phase is closed for job ${jobId}`);
    }
    if (!job.assignedValidators.includes(dto.validatorId)) {
      throw new ForbiddenException(`Validator ${dto.validatorId} is not on the committee of job ${jobId}`);
    }
    if (commitments.some((c) => c.validatorId === dto.validatorId)) {
      throw new ConflictException(`Validator ${dto.validatorId} has already committed for job ${jobId}`);
    }
    if (this.frozenMembers(job).includes(dto.validatorId)) {
      throw new ForbiddenException(
        `Validator ${dto.validatorId} missed the commit phase before the committee of job ${jobId} was expanded`,
      );
    }

    // The signature ties the commitment to the validator's registered key, so
    // a committee seat cannot be filled by whoever knows the validator id.
    const validator = await this.validatorsService.findOne(dto.validatorId);
    let signer: string;
    try {
      signer = recoverCommitSigner(dto.commitHash, dto.signature);
    } catch {
      throw new BadRequestException('signature is not a valid signature of the commit hash');
    }
    if (signer.toLowerCase() !== validator.address.toLowerCase()) {
      throw new ForbiddenException('Commitment is not signed by the validator address');
    }

    const saved = await this.commitmentRepo.save(
      this.commitmentRepo.create({
        jobId,
        validatorId: dto.validatorId,
        commitHash: dto.commitHash.toLowerCase(),
        outcome: null,
        salt: null,
        revealedAt: null,
      }),
    );
    this.logger.log(`Validator ${dto.validatorId} committed for job ${jobId}`);
    return this.view(saved);
  }

  async reveal(jobId: string, dto: RevealVerdictDto, now = new Date()): Promise<RoundStatus> {
    const { job, commitments } = await this.loadRound(jobId);
    const phase = this.phaseOf(job, commitments, now);
    if (phase === 'finalized') {
      throw new ConflictException(`Job ${jobId} is already finalized`);
    }
    if (phase === 'commit') {
      // Revealing early would hand the vote to validators that have not
      // committed yet, which is exactly what the scheme exists to prevent.
      throw new ConflictException(`Commit phase is still open for job ${jobId}`);
    }
    if (job.revealDeadline && now > job.revealDeadline) {
      throw new ConflictException(`Reveal phase is closed for job ${jobId}`);
    }

    const commitment = commitments.find((c) => c.validatorId === dto.validatorId);
    if (!commitment) {
      throw new NotFoundException(`Validator ${dto.validatorId} has no commitment for job ${jobId}`);
    }
    if (commitment.revealedAt) {
      throw new ConflictException(`Validator ${dto.validatorId} has already revealed for job ${jobId}`);
    }

    const expected = computeCommitHash(jobId, dto.validatorId, dto.outcome, dto.salt);
    if (expected.toLowerCase() !== commitment.commitHash.toLowerCase()) {
      throw new BadRequestException('Reveal does not match the commitment');
    }

    commitment.outcome = dto.outcome;
    commitment.salt = dto.salt.toLowerCase();
    commitment.revealedAt = now;
    await this.commitmentRepo.save(commitment);
    this.logger.log(`Validator ${dto.validatorId} revealed ${dto.outcome} for job ${jobId}`);

    if (commitments.every((c) => c.revealedAt)) {
      await this.settle(job, commitments, now);
    }
    return this.status(jobId, now);
  }

  /**
   * Closes a round whose reveal deadline has passed. Reveals close the round
   * themselves once every commitment is opened; this is for the case where a
   * validator committed and then went silent.
   */
  async finalize(jobId: string, now = new Date()): Promise<RoundStatus> {
    const { job, commitments } = await this.loadRound(jobId);
    const phase = this.phaseOf(job, commitments, now);
    if (phase === 'commit') {
      throw new ConflictException(`Commit phase is still open for job ${jobId}`);
    }
    if (phase === 'reveal') {
      const allRevealed = commitments.every((c) => c.revealedAt);
      const deadlinePassed = !!job.revealDeadline && now > job.revealDeadline;
      if (!allRevealed && !deadlinePassed) {
        throw new ConflictException(`Reveal phase is still open for job ${jobId}`);
      }
      await this.settle(job, commitments, now);
    }
    return this.status(jobId, now);
  }

  async status(jobId: string, now = new Date()): Promise<RoundStatus> {
    const { job, commitments } = await this.loadRound(jobId);
    const phase = this.phaseOf(job, commitments, now);
    // While a widened committee is committing, the votes revealed in the round
    // that timed out stay hidden; otherwise the new members could copy them.
    const sealed = phase === 'commit';
    return {
      jobId,
      phase,
      jobStatus: job.status,
      committee: job.assignedValidators,
      commitDeadline: job.commitDeadline,
      revealDeadline: job.revealDeadline,
      expansions: job.quorumExpansions ?? 0,
      commitments: commitments.map((c) => this.view(c, sealed)),
      tally: this.tally(job, sealed ? [] : commitments),
    };
  }

  private async loadRound(
    jobId: string,
  ): Promise<{ job: VerificationJob; commitments: VerdictCommitment[] }> {
    const job = await this.jobsService.findOne(jobId);
    if (job.verdictMode !== VerdictMode.COMMIT_REVEAL) {
      throw new BadRequestException(`Job ${jobId} does not use commit-reveal verdicts`);
    }
    const commitments = await this.commitmentRepo.find({
      where: { jobId },
      order: { committedAt: 'ASC' },
    });
    return { job, commitments };
  }

  private phaseOf(
    job: VerificationJob,
    commitments: VerdictCommitment[],
    now: Date,
  ): CommitRevealPhase {
    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) return 'finalized';
    const committed = new Set(commitments.map((c) => c.validatorId));
    const frozen = new Set(this.frozenMembers(job));
    const everyoneCommitted = job.assignedValidators.every(
      (validatorId) => committed.has(validatorId) || frozen.has(validatorId),
    );
    const deadlinePassed = !!job.commitDeadline && now > job.commitDeadline;
    return everyoneCommitted || deadlinePassed ? 'reveal' : 'commit';
  }

  private tally(job: VerificationJob, commitments: VerdictCommitment[]): RoundTally {
    const votes = commitments
      .filter((c) => c.revealedAt && c.outcome)
      .map((c) => ({ validatorId: c.validatorId, outcome: c.outcome as VerdictOutcome }));
    const rules = this.rulesOf(job);
    const counted = tallyReveals(votes, job.assignedValidators.length);
    const weighted = tallyWeighted(votes, job.assignedValidators, rules);
    return {
      ...counted,
      outcome: weighted.outcome,
      supporters: weighted.supporters,
      quorum: Number(requiredWeight(BigInt(job.assignedValidators.length), rules.thresholdBps)),
      weighted,
    };
  }

  /** The rules fixed on the job at assignment; older jobs vote one-per-validator. */
  private rulesOf(job: VerificationJob): QuorumRules {
    return {
      weighting: job.quorumWeighting ?? QuorumWeighting.EQUAL,
      thresholdBps: job.quorumThresholdBps ?? DEFAULT_THRESHOLD_BPS,
      weights: job.committeeWeights ?? {},
    };
  }

  /** Members seated before the last expansion that never committed. */
  private frozenMembers(job: VerificationJob): string[] {
    if (!job.expandedFrom) return [];
    return job.assignedValidators.slice(0, job.expandedFrom);
  }

  /**
   * Fallback for a round that ended without a quorum: draws more validators
   * from outside the committee and opens a new commit-reveal window, keeping
   * the votes already revealed. Returns false when the round cannot be
   * widened (expansions used up, nobody left to draw), and the job fails.
   */
  private async expandCommittee(
    job: VerificationJob,
    tally: RoundTally,
    now: Date,
  ): Promise<boolean> {
    const maxExpansions = Number(this.configService.get('quorum.maxExpansions', 1));
    const expansions = job.quorumExpansions ?? 0;
    if (expansions >= maxExpansions) return false;

    const size =
      Number(this.configService.get('quorum.expansionSize', 0)) || job.assignedValidators.length;
    const outside = (await this.validatorsService.findEligible()).filter(
      (candidate) => !job.assignedValidators.includes(candidate.id),
    );
    // Seeded per job and expansion, like the original draw, so it can be
    // recomputed by anyone holding the validator set.
    const added = selectWeighted(outside, size, `${job.id}:expansion:${expansions + 1}`);
    if (added.length === 0) return false;

    const stakes: Record<string, string> = {};
    for (const candidate of outside) {
      if (candidate.stake !== undefined && added.includes(candidate.id)) {
        stakes[candidate.id] = candidate.stake;
      }
    }
    const expanded = await this.jobsService.expandCommittee(job.id, added, stakes, now);
    this.logger.warn(
      `Job ${job.id}: no quorum (${tally.weighted.weights[VerdictOutcome.ACCEPT]}/` +
        `${tally.weighted.weights[VerdictOutcome.REJECT]}/${tally.weighted.weights[VerdictOutcome.PARTIAL]} ` +
        `of ${tally.weighted.requiredWeight} needed); committee widened by ${added.length} to ` +
        `${expanded.assignedValidators.length}, expansion ${expanded.quorumExpansions} of ${maxExpansions}`,
    );
    return true;
  }

  private async settle(
    job: VerificationJob,
    commitments: VerdictCommitment[],
    now: Date,
  ): Promise<void> {
    const tally = this.tally(job, commitments);
    if (!tally.outcome && (await this.expandCommittee(job, tally, now))) return;
    if (!tally.outcome) {
      await this.jobsService.updateStatus(job.id, JobStatus.FAILED);
      await this.notify(job.id, () =>
        this.webhooksService.notifyJobFailed(job, 'the committee did not reach a quorum'),
      );
      this.logger.warn(
        `Job ${job.id} failed: no outcome reached ${tally.weighted.requiredWeight} of ` +
          `${tally.weighted.totalWeight} (${tally.weighted.weighting} weighting, ` +
          `${JSON.stringify(tally.weighted.weights)})`,
      );
      return;
    }

    const verdict = await this.verdictsService.createAndPublish({
      sessionId: job.sessionId,
      jobId: job.id,
      outcome: tally.outcome,
      payableAmount: '0',
      metaHash: job.resultHash || job.requestHash,
      validatorIds: tally.supporters,
    });
    await this.jobsService.updateStatus(job.id, JobStatus.COMPLETED);
    await this.notify(job.id, () => this.webhooksService.notifyVerdict(job, verdict));

    // Validators that revealed the losing outcome were wrong about this job;
    // those that never revealed are left to the availability checks.
    const dissenters = commitments
      .filter((c) => c.revealedAt && c.outcome !== tally.outcome)
      .map((c) => c.validatorId);
    await this.reputationService.recordForValidators(tally.supporters, { accurate: true });
    await this.reputationService.recordForValidators(dissenters, { accurate: false });
    this.logger.log(
      `Job ${job.id} finalized as ${tally.outcome} by ${tally.supporters.length} of ` +
        `${job.assignedValidators.length} validators`,
    );
  }

  /** The round is settled either way; a webhook that cannot be queued is logged. */
  private async notify(jobId: string, send: () => Promise<unknown>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error(`Could not queue the webhook for job ${jobId}: ${(error as Error).message}`);
    }
  }

  /**
   * Never exposes the salt; the outcome is empty until the reveal, and while
   * the round is sealed (a widened committee is committing).
   */
  private view(commitment: VerdictCommitment, sealed = false): CommitmentView {
    return {
      validatorId: commitment.validatorId,
      committedAt: commitment.committedAt,
      revealed: !!commitment.revealedAt,
      outcome: sealed ? null : commitment.outcome,
      revealedAt: commitment.revealedAt,
    };
  }
}
