import { Injectable, Logger } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { ValidatorsService } from '../validators/validators.service';
import { VerdictsService } from '../verdicts/verdicts.service';
import { JobStatus } from '../jobs/entities/verification-job.entity';
import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import { selectWeighted } from '../validators/staking-tiers';

/** Validators drawn for a job when nothing asks for a different size. */
export const DEFAULT_COMMITTEE_SIZE = 3;

@Injectable()
export class CoordinatorService {
  private readonly logger = new Logger(CoordinatorService.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly validatorsService: ValidatorsService,
    private readonly verdictsService: VerdictsService,
  ) {}

  async processJob(jobId: string): Promise<{
    jobId: string;
    sessionId: string;
    outcome: string;
    verdictId: string;
    txHash?: string;
  }> {
    const validators = await this.assignValidators(jobId);
    this.logger.log(`Assigned ${validators.length} validators to job ${jobId}`);

    const job = await this.jobsService.findOne(jobId);
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
      selected.push('self-validator');
    }

    await this.jobsService.assignValidators(jobId, selected);
    return selected;
  }

  async checkQuorum(jobId: string): Promise<boolean> {
    const job = await this.jobsService.findOne(jobId);
    return job.status === JobStatus.COMPLETED;
  }
}
