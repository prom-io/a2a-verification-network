import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { VerificationJob } from '../jobs/entities/verification-job.entity';
import { Verdict } from '../verdicts/entities/verdict.entity';
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEvent,
} from './entities/webhook-delivery.entity';
import { WebhookHttpClient } from './webhook-http.client';
import { buildSignedHeaders, forbiddenTargetReason } from './webhook-signature';
import {
  DEFAULT_RETRY_POLICY,
  DeadLetterReason,
  ResponseClass,
  RetryPolicy,
  classifyResponse,
  decideRetry,
  parseRetryAfter,
} from './webhook-retry';
import { SigningSecretSettings, activeSigningSecrets, signingSecretProblems } from './webhook-secrets';

type NotifiableJob = Pick<VerificationJob, 'id' | 'sessionId' | 'callbackUrl'>;

/**
 * Notifies job submitters when their job has a verdict (or has failed without
 * one).
 *
 * Every notification is first written to the database and only then sent, so
 * it survives a restart and is retried with jittered backoff until the
 * receiver answers 2xx. Deliveries that cannot succeed (attempts used up, too
 * old, refused by the receiver) move to a dead-letter queue, from which they
 * can be replayed once the receiver is fixed. The verdict flow never waits for the receiver:
 * the first attempt is started in the background.
 */
@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private timer?: NodeJS.Timeout;
  private retrying = false;

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    private readonly httpClient: WebhookHttpClient,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    // Refuse to start rather than send deliveries anyone could forge.
    const problems = signingSecretProblems(this.secretSettings());
    if (problems.length > 0) {
      throw new Error(`Webhook signing is misconfigured: ${problems.join('; ')}`);
    }
    const secrets = activeSigningSecrets(this.secretSettings());
    if (secrets.length > 1) {
      this.logger.log('Webhook secret rotation in progress: deliveries carry two signatures');
    }

    const pollMs = Number(this.configService.get('WEBHOOK_RETRY_POLL_MS', 30_000));
    if (!(pollMs > 0)) return;
    this.timer = setInterval(() => {
      this.retryDue().catch((error: Error) =>
        this.logger.error(`Webhook retry run failed: ${error.message}`),
      );
    }, pollMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Queues `verdict.published` for the job's callback URL, if it has one. */
  async notifyVerdict(
    job: NotifiableJob,
    verdict: Verdict & { txHash?: string },
  ): Promise<WebhookDelivery | null> {
    return this.enqueue(job, WebhookEvent.VERDICT_PUBLISHED, {
      verdictId: verdict.id,
      outcome: verdict.outcome,
      payableAmount: verdict.payableAmount,
      metaHash: verdict.metaHash,
      signatures: verdict.signatures,
      txHash: verdict.txHash ?? null,
    });
  }

  /** Queues `job.failed` when a job ends without a verdict. */
  async notifyJobFailed(job: NotifiableJob, reason: string): Promise<WebhookDelivery | null> {
    return this.enqueue(job, WebhookEvent.JOB_FAILED, { reason });
  }

  async listForJob(jobId: string): Promise<WebhookDelivery[]> {
    return this.deliveryRepo.find({ where: { jobId }, order: { createdAt: 'ASC' } });
  }

  /**
   * Sends a delivery again on request, e.g. after the receiver was fixed. A
   * dead-lettered delivery that fails again stays in the dead-letter queue.
   */
  async redeliver(id: string, now = new Date()): Promise<WebhookDelivery> {
    const delivery = await this.deliveryRepo.findOneBy({ id });
    if (!delivery) throw new NotFoundException(`Webhook delivery ${id} not found`);
    if (delivery.status === WebhookDeliveryStatus.DELIVERED) {
      throw new ConflictException(`Webhook delivery ${id} has already been delivered`);
    }
    return this.attempt(delivery, now, true);
  }

  /** The dead-letter queue, most recently given up on first. */
  async listDeadLetters(limit = 50, jobId?: string): Promise<WebhookDelivery[]> {
    return this.deliveryRepo.find({
      where: { status: WebhookDeliveryStatus.DEAD_LETTER, ...(jobId ? { jobId } : {}) },
      order: { deadLetteredAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Puts dead-lettered deliveries back on the retry schedule with a fresh set
   * of attempts, due at once. With ids only those are replayed (ids that are
   * not dead-lettered are skipped); without, the oldest `limit` dead letters.
   * Deliveries whose target is refused are never replayed: nothing about
   * retrying them can succeed.
   */
  async replayDeadLetters(
    options: { ids?: string[]; limit?: number },
    now = new Date(),
  ): Promise<WebhookDelivery[]> {
    const candidates = options.ids?.length
      ? await this.deliveryRepo.find({
          where: { id: In(options.ids), status: WebhookDeliveryStatus.DEAD_LETTER },
        })
      : await this.deliveryRepo.find({
          where: { status: WebhookDeliveryStatus.DEAD_LETTER },
          order: { deadLetteredAt: 'ASC' },
          take: options.limit ?? 50,
        });

    const replayed: WebhookDelivery[] = [];
    for (const delivery of candidates) {
      if (delivery.deadLetterReason === DeadLetterReason.TARGET_REFUSED) continue;
      delivery.status = WebhookDeliveryStatus.PENDING;
      delivery.attempts = 0;
      delivery.nextAttemptAt = now;
      delivery.replayedAt = now;
      delivery.replays += 1;
      delivery.deadLetteredAt = null;
      delivery.deadLetterReason = null;
      replayed.push(await this.deliveryRepo.save(delivery));
    }
    if (replayed.length > 0) {
      this.logger.log(`Replaying ${replayed.length} dead-lettered webhook deliveries`);
    }
    return replayed;
  }

  /** Retries every pending delivery whose backoff has elapsed. */
  async retryDue(now = new Date(), limit = 50): Promise<number> {
    if (this.retrying) return 0;
    this.retrying = true;
    try {
      const due = await this.deliveryRepo.find({
        where: { status: WebhookDeliveryStatus.PENDING, nextAttemptAt: LessThanOrEqual(now) },
        order: { nextAttemptAt: 'ASC' },
        take: limit,
      });
      for (const delivery of due) await this.attempt(delivery, now);
      return due.length;
    } finally {
      this.retrying = false;
    }
  }

  /**
   * One delivery attempt. Never throws for a receiver-side problem: the result
   * is recorded on the delivery and decides whether it is retried or goes to
   * the dead-letter queue.
   */
  async attempt(delivery: WebhookDelivery, now = new Date(), manual = false): Promise<WebhookDelivery> {
    delivery.attempts += 1;

    const refusal = forbiddenTargetReason(
      delivery.url,
      String(this.configService.get('WEBHOOK_ALLOW_PRIVATE_TARGETS', 'false')) === 'true',
    );
    if (refusal) {
      // Retrying cannot make a refused target acceptable.
      delivery.lastError = `target refused: ${refusal}`;
      delivery.lastStatusCode = null;
      this.deadLetter(delivery, DeadLetterReason.TARGET_REFUSED, now);
      this.logger.warn(`Webhook ${delivery.id} not sent: ${delivery.lastError}`);
      return this.deliveryRepo.save(delivery);
    }

    // The delivery id goes into the signed body as well as the header, so a
    // receiver can use it as an idempotency key that cannot be swapped out.
    const body = JSON.stringify({ ...delivery.payload, deliveryId: delivery.id });
    const headers = buildSignedHeaders({
      secrets: activeSigningSecrets(this.secretSettings(), now),
      deliveryId: delivery.id,
      event: delivery.event,
      attempt: delivery.attempts,
      body,
      now,
    });

    let outcome: ResponseClass;
    let retryAfterMs: number | null = null;
    try {
      const response = await this.httpClient.post(
        delivery.url,
        body,
        headers,
        Number(this.configService.get('WEBHOOK_TIMEOUT_MS', 5000)),
      );
      delivery.lastStatusCode = response.status;
      outcome = classifyResponse(response.status);
      delivery.lastError = outcome === 'delivered' ? null : `receiver answered ${response.status}`;
      retryAfterMs = parseRetryAfter(response.retryAfter, now);
    } catch (error) {
      delivery.lastStatusCode = null;
      delivery.lastError = (error as Error).message;
      outcome = 'retry';
    }

    if (outcome === 'delivered') {
      delivery.status = WebhookDeliveryStatus.DELIVERED;
      delivery.deliveredAt = now;
      delivery.nextAttemptAt = null;
      delivery.deadLetteredAt = null;
      delivery.deadLetterReason = null;
      return this.deliveryRepo.save(delivery);
    }

    const label = `Webhook ${delivery.id} attempt ${delivery.attempts}${manual ? ' (manual)' : ''}`;
    if (outcome !== 'retry') {
      this.deadLetter(delivery, outcome, now);
    } else if (delivery.status === WebhookDeliveryStatus.DEAD_LETTER) {
      // A manual redelivery of a dead letter that fails again leaves it in the
      // queue; it does not put the delivery back on the retry schedule.
      delivery.deadLetteredAt = now;
    } else {
      const decision = decideRetry({
        attempts: delivery.attempts,
        deliveryId: delivery.id,
        createdAt: delivery.replayedAt ?? delivery.createdAt ?? now,
        now,
        policy: this.retryPolicy(),
        retryAfterMs,
      });
      if (decision.deadLetterReason) {
        this.deadLetter(delivery, decision.deadLetterReason, now);
      } else {
        delivery.status = WebhookDeliveryStatus.PENDING;
        delivery.nextAttemptAt = decision.nextAttemptAt;
      }
    }
    this.logger.warn(
      `${label} failed: ${delivery.lastError}` +
        (delivery.status === WebhookDeliveryStatus.DEAD_LETTER
          ? `; dead-lettered (${delivery.deadLetterReason})`
          : `; next attempt at ${delivery.nextAttemptAt?.toISOString()}`),
    );
    return this.deliveryRepo.save(delivery);
  }

  private deadLetter(delivery: WebhookDelivery, reason: DeadLetterReason, now: Date): void {
    delivery.status = WebhookDeliveryStatus.DEAD_LETTER;
    delivery.nextAttemptAt = null;
    delivery.deadLetteredAt = now;
    delivery.deadLetterReason = reason;
  }

  private retryPolicy(): RetryPolicy {
    const number = (key: string, fallback: number, min = 0) => {
      const value = Number(this.configService.get(key, fallback));
      return Number.isFinite(value) && value >= min ? value : fallback;
    };
    return {
      baseMs: number('WEBHOOK_BACKOFF_BASE_MS', DEFAULT_RETRY_POLICY.baseMs, 1),
      capMs: number('WEBHOOK_BACKOFF_CAP_MS', DEFAULT_RETRY_POLICY.capMs, 1),
      jitter: Math.min(1, number('WEBHOOK_BACKOFF_JITTER', DEFAULT_RETRY_POLICY.jitter)),
      maxAttempts: number('WEBHOOK_MAX_ATTEMPTS', DEFAULT_RETRY_POLICY.maxAttempts, 1),
      maxAgeMs: number('WEBHOOK_MAX_AGE_HOURS', DEFAULT_RETRY_POLICY.maxAgeMs / 3_600_000) * 3_600_000,
    };
  }

  private secretSettings(): SigningSecretSettings {
    return {
      current: this.configService.get<string>('WEBHOOK_SIGNING_SECRET'),
      previous: this.configService.get<string>('WEBHOOK_SIGNING_SECRET_PREVIOUS'),
      previousUntil: this.configService.get<string>('WEBHOOK_SIGNING_SECRET_PREVIOUS_UNTIL'),
      nodeEnv: this.configService.get<string>('NODE_ENV'),
    };
  }

  private async enqueue(
    job: NotifiableJob,
    event: WebhookEvent,
    data: Record<string, unknown>,
  ): Promise<WebhookDelivery | null> {
    if (!job.callbackUrl) return null;

    const delivery = await this.deliveryRepo.save(
      this.deliveryRepo.create({
        jobId: job.id,
        sessionId: job.sessionId,
        url: job.callbackUrl,
        event,
        payload: {
          event,
          jobId: job.id,
          sessionId: job.sessionId,
          occurredAt: new Date().toISOString(),
          ...data,
        },
        status: WebhookDeliveryStatus.PENDING,
        attempts: 0,
        lastStatusCode: null,
        lastError: null,
        nextAttemptAt: null,
        deliveredAt: null,
        deadLetteredAt: null,
        deadLetterReason: null,
        replayedAt: null,
        replays: 0,
      }),
    );

    // Started, not awaited: a slow receiver must not hold up the verdict.
    void this.attempt(delivery).catch((error: Error) =>
      this.logger.error(`Webhook ${delivery.id} could not be recorded: ${error.message}`),
    );
    return delivery;
  }
}
