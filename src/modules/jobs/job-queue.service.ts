import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoordinatorService } from '../coordinator/coordinator.service';
import { JobStatus, VerificationJob } from './entities/verification-job.entity';
import { JobsService } from './jobs.service';
import { DEFAULT_PRIORITY_OPTIONS, PriorityOptions, orderQueue } from './priority';

export interface QueuedJobView {
  position: number;
  score: number;
  waitedSeconds: number;
  job: VerificationJob;
}

export interface DrainResult {
  jobId: string;
  outcome: string;
  verdictId?: string | null;
  error?: string;
}

/**
 * Queue of jobs that were submitted for deferred processing.
 *
 * Jobs wait in `pending` and are handed to the coordinator in priority order,
 * either by the background poller (JOB_QUEUE_POLL_MS) or by an explicit drain.
 */
@Injectable()
export class JobQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobQueueService.name);
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    private readonly jobsService: JobsService,
    private readonly coordinatorService: CoordinatorService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const pollMs = Number(this.configService.get('JOB_QUEUE_POLL_MS', 0));
    if (!(pollMs > 0)) return;

    const batch = Number(this.configService.get('JOB_QUEUE_BATCH_SIZE', 10));
    this.timer = setInterval(() => {
      this.drain(batch).catch((error: Error) =>
        this.logger.error(`Queue drain failed: ${error.message}`),
      );
    }, pollMs);
    // The poller must not keep the process alive on shutdown.
    this.timer.unref();
    this.logger.log(`Job queue poller started: every ${pollMs}ms, batches of ${batch}`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Pending jobs in the order they will be processed. */
  async list(limit = 50, now = new Date()): Promise<QueuedJobView[]> {
    const options = this.options();
    const pending = await this.jobsService.findPendingByPriority(limit, options);
    return orderQueue(pending, now, options).map(({ job, position, score, waitedSeconds }) => ({
      position,
      score,
      waitedSeconds,
      job,
    }));
  }

  /**
   * Processes up to `limit` jobs from the head of the queue, one at a time so
   * the order means something. A job that throws is marked failed and the
   * drain moves on; one poisoned job must not block everything behind it.
   */
  async drain(limit = 10, now = new Date()): Promise<DrainResult[]> {
    if (this.draining) return [];
    this.draining = true;
    try {
      const results: DrainResult[] = [];
      for (const { job } of await this.list(limit, now)) {
        // Another instance may have taken the job since the queue was read.
        if (!(await this.jobsService.claimPending(job.id))) continue;
        try {
          const processed = await this.coordinatorService.processJob(job.id);
          results.push({
            jobId: job.id,
            outcome: processed.outcome,
            verdictId: processed.verdictId,
          });
        } catch (error) {
          const message = (error as Error).message;
          this.logger.error(`Queued job ${job.id} failed: ${message}`);
          await this.jobsService.updateStatus(job.id, JobStatus.FAILED);
          results.push({ jobId: job.id, outcome: 'failed', error: message });
        }
      }
      return results;
    } finally {
      this.draining = false;
    }
  }

  private options(): PriorityOptions {
    const feeUnit = String(
      this.configService.get('JOB_QUEUE_FEE_UNIT_WEI', DEFAULT_PRIORITY_OPTIONS.feeUnitWei.toString()),
    );
    const aging = Number(
      this.configService.get('JOB_QUEUE_AGING_SECONDS', DEFAULT_PRIORITY_OPTIONS.agingSeconds),
    );
    return {
      feeUnitWei: /^\d+$/.test(feeUnit) && BigInt(feeUnit) > 0n ? BigInt(feeUnit) : DEFAULT_PRIORITY_OPTIONS.feeUnitWei,
      agingSeconds: Number.isFinite(aging) && aging >= 0 ? aging : DEFAULT_PRIORITY_OPTIONS.agingSeconds,
    };
  }
}
