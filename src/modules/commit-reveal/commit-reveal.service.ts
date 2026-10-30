import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
import { VerdictCommitment } from './entities/verdict-commitment.entity';
import { CommitVerdictDto } from './dto/commit-verdict.dto';
import { RevealVerdictDto } from './dto/reveal-verdict.dto';
import { Tally, computeCommitHash, recoverCommitSigner, tallyReveals } from './commitment';

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
  commitments: CommitmentView[];
  tally: Tally;
}

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
      await this.settle(job, commitments);
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
      await this.settle(job, commitments);
    }
    return this.status(jobId, now);
  }

  async status(jobId: string, now = new Date()): Promise<RoundStatus> {
    const { job, commitments } = await this.loadRound(jobId);
    return {
      jobId,
      phase: this.phaseOf(job, commitments, now),
      jobStatus: job.status,
      committee: job.assignedValidators,
      commitDeadline: job.commitDeadline,
      revealDeadline: job.revealDeadline,
      commitments: commitments.map((c) => this.view(c)),
      tally: this.tally(job, commitments),
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
    const everyoneCommitted = commitments.length >= job.assignedValidators.length;
    const deadlinePassed = !!job.commitDeadline && now > job.commitDeadline;
    return everyoneCommitted || deadlinePassed ? 'reveal' : 'commit';
  }

  private tally(job: VerificationJob, commitments: VerdictCommitment[]): Tally {
    const votes = commitments
      .filter((c) => c.revealedAt && c.outcome)
      .map((c) => ({ validatorId: c.validatorId, outcome: c.outcome as VerdictOutcome }));
    return tallyReveals(votes, job.assignedValidators.length);
  }

  private async settle(job: VerificationJob, commitments: VerdictCommitment[]): Promise<void> {
    const tally = this.tally(job, commitments);
    if (!tally.outcome) {
      await this.jobsService.updateStatus(job.id, JobStatus.FAILED);
      this.logger.warn(
        `Job ${job.id} failed: no outcome reached the quorum of ${tally.quorum} ` +
          `(${JSON.stringify(tally.counts)})`,
      );
      return;
    }

    await this.verdictsService.createAndPublish({
      sessionId: job.sessionId,
      jobId: job.id,
      outcome: tally.outcome,
      payableAmount: '0',
      metaHash: job.resultHash || job.requestHash,
      validatorIds: tally.supporters,
    });
    await this.jobsService.updateStatus(job.id, JobStatus.COMPLETED);

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

  /** Never exposes the salt; the outcome is empty until the reveal. */
  private view(commitment: VerdictCommitment): CommitmentView {
    return {
      validatorId: commitment.validatorId,
      committedAt: commitment.committedAt,
      revealed: !!commitment.revealedAt,
      outcome: commitment.outcome,
      revealedAt: commitment.revealedAt,
    };
  }
}
