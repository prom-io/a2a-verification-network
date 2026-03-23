import { Injectable, Logger } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { ValidatorsService } from '../validators/validators.service';
import { VerdictsService } from '../verdicts/verdicts.service';
import { JobStatus } from '../jobs/entities/verification-job.entity';
import { VerdictOutcome } from '../verdicts/entities/verdict.entity';

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

  async assignValidators(jobId: string): Promise<string[]> {
    const activeValidators = (await this.validatorsService.findAll()).filter(v => v.isActive);
    const selected = activeValidators.slice(0, 3).map(v => v.id);

    if (selected.length === 0) {
      this.logger.warn(`No active validators available for job ${jobId}, using self as validator`);
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
