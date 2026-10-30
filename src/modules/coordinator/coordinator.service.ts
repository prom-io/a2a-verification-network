import { Injectable, Logger } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { ValidatorsService } from '../validators/validators.service';
import { VerdictsService } from '../verdicts/verdicts.service';
import { ReputationService } from '../reputation/reputation.service';
import { JobStatus, VerdictMode } from '../jobs/entities/verification-job.entity';
import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import { selectWeighted } from '../validators/staking-tiers';

/** Validators drawn for a job when nothing asks for a different size. */
export const DEFAULT_COMMITTEE_SIZE = 3;

/** Placeholder committee member used when no validator is staked. */
export const SELF_VALIDATOR = 'self-validator';

@Injectable()
export class CoordinatorService {
  private readonly logger = new Logger(CoordinatorService.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly validatorsService: ValidatorsService,
    private readonly verdictsService: VerdictsService,
    private readonly reputationService: ReputationService,
  ) {}

  async processJob(jobId: string): Promise<{
    jobId: string;
    sessionId: string;
    outcome: string;
    verdictId: string | null;
    txHash?: string;
  }> {
    const validators = await this.assignValidators(jobId);
    this.logger.log(`Assigned ${validators.length} validators to job ${jobId}`);

    const job = await this.jobsService.findOne(jobId);

    if (job.verdictMode === VerdictMode.COMMIT_REVEAL) {
      // The verdict comes from the committee's commit-reveal round, so there is
      // nothing to publish yet. Without a staked committee nobody can vote and
      // the job would wait for its deadlines for nothing.
      const hasCommittee = !validators.includes(SELF_VALIDATOR);
      await this.jobsService.updateStatus(
        jobId,
        hasCommittee ? JobStatus.IN_PROGRESS : JobStatus.FAILED,
      );
      return {
        jobId: job.id,
        sessionId: job.sessionId,
        outcome: hasCommittee ? 'pending' : 'failed',
        verdictId: null,
      };
    }

    await this.jobsService.updateStatus(jobId, JobStatus.IN_PROGRESS);

    const outcome = VerdictOutcome.ACCEPT;
    const payableAmount = '0';
    const metaHash = job.resultHash || job.requestHash;

    const verdict = await this.verdictsService.createAndPublish({
      sessionId: job.sessionId,
      jobId: job.id,
      outcome,
      payableAmount,
      metaHash,
      validatorIds: validators,
    });

    await this.jobsService.updateStatus(jobId, JobStatus.COMPLETED);
    await this.reputationService.recordForValidators(
      validators.filter((id) => id !== SELF_VALIDATOR),
      { accurate: true },
    );

    this.logger.log(`Job ${jobId} completed with outcome: ${outcome}`);

    return {
      jobId: job.id,
      sessionId: job.sessionId,
      outcome,
      verdictId: verdict.id,
      txHash: (verdict as any).txHash,
    };
  }

  /**
   * Draws the committee for a job from the staked, active validators. The
   * draw is weighted by staking tier and seeded with the job id, so it is
   * reproducible and a validator cannot influence it by registering earlier.
   */
  async assignValidators(jobId: string, size = DEFAULT_COMMITTEE_SIZE): Promise<string[]> {
    const eligible = await this.validatorsService.findEligible();
    const selected = selectWeighted(eligible, size, jobId);

    if (selected.length === 0) {
      this.logger.warn(`No staked active validators available for job ${jobId}, using self as validator`);
      selected.push(SELF_VALIDATOR);
    }

    await this.jobsService.assignValidators(jobId, selected);
    return selected;
  }

  async checkQuorum(jobId: string): Promise<boolean> {
    const job = await this.jobsService.findOne(jobId);
    return job.status === JobStatus.COMPLETED;
  }
}
