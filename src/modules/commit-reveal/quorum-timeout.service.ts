import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsService } from '../jobs/jobs.service';
import { CommitRevealService } from './commit-reveal.service';

export interface SweepResult {
  /** Rounds closed with a verdict. */
  completed: string[];
  /** Rounds that had no quorum and were given a widened committee. */
  expanded: string[];
  /** Rounds that had no quorum and could not be widened any more. */
  failed: string[];
  /** Rounds the sweep could not close, with the reason. */
  errors: Array<{ jobId: string; error: string }>;
}

/**
 * Closes commit-reveal rounds whose reveal deadline has passed.
 *
 * Without it a round where a validator committed and then went silent waits
 * for somebody to call finalize. Closing applies the quorum fallback: a round
 * without a quorum gets a widened committee while expansions remain, and only
 * fails after that.
 */
@Injectable()
export class QuorumTimeoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuorumTimeoutService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly jobsService: JobsService,
    private readonly commitRevealService: CommitRevealService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(this.configService.get('quorum.timeoutSweepMs', 0));
    if (!(intervalMs > 0)) return;
    this.timer = setInterval(() => {
      this.sweep().catch((error: Error) =>
        this.logger.error(`Quorum timeout sweep failed: ${error.message}`),
      );
    }, intervalMs);
    this.timer.unref();
    this.logger.log(`Quorum timeout sweep every ${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date(), limit = 50): Promise<SweepResult> {
    const result: SweepResult = { completed: [], expanded: [], failed: [], errors: [] };
    if (this.sweeping) return result;
    this.sweeping = true;
    try {
      for (const job of await this.jobsService.findExpiredRounds(now, limit)) {
        try {
          const round = await this.commitRevealService.finalize(job.id, now);
          if (round.phase !== 'finalized') result.expanded.push(job.id);
          else if (round.tally.outcome) result.completed.push(job.id);
          else result.failed.push(job.id);
        } catch (error) {
          // One broken round must not keep the others open.
          const message = (error as Error).message;
          this.logger.error(`Could not close the round of job ${job.id}: ${message}`);
          result.errors.push({ jobId: job.id, error: message });
        }
      }
      const closed = result.completed.length + result.expanded.length + result.failed.length;
      if (closed > 0) {
        this.logger.log(
          `Quorum timeouts: ${result.completed.length} decided, ${result.expanded.length} widened, ` +
            `${result.failed.length} failed`,
        );
      }
      return result;
    } finally {
      this.sweeping = false;
    }
  }
}
