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
import { LessThanOrEqual, Repository } from 'typeorm';
import { VerificationJob } from '../jobs/entities/verification-job.entity';
import { Verdict } from '../verdicts/entities/verdict.entity';
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEvent,
} from './entities/webhook-delivery.entity';
import { WebhookHttpClient } from './webhook-http.client';
import { SIGNATURE_HEADER, backoffMs, forbiddenTargetReason, signPayload } from './webhook-signature';

type NotifiableJob = Pick<VerificationJob, 'id' | 'sessionId' | 'callbackUrl'>;

/**
 * Notifies job submitters when their job has a verdict (or has failed without
 * one).
 *
 * Every notification is first written to the database and only then sent, so
 * it survives a restart and is retried with backoff until the receiver answers
 * 2xx or the attempts run out. The verdict flow never waits for the receiver:
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

  /** Sends a delivery again on request, e.g. after the receiver was fixed. */
  async redeliver(id: string, now = new Date()): Promise<WebhookDelivery> {
    const delivery = await this.deliveryRepo.findOneBy({ id });
    if (!delivery) throw new NotFoundException(`Webhook delivery ${id} not found`);
    if (delivery.status === WebhookDeliveryStatus.DELIVERED) {
      throw new ConflictException(`Webhook delivery ${id} has already been delivered`);
    }
    return this.attempt(delivery, now, true);
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
   * is recorded on the delivery and decides whether it is retried.
   */
  async attempt(delivery: WebhookDelivery, now = new Date(), manual = false): Promise<WebhookDelivery> {
    const maxAttempts = Number(this.configService.get('WEBHOOK_MAX_ATTEMPTS', 5));
    delivery.attempts += 1;

    const refusal = forbiddenTargetReason(
      delivery.url,
      String(this.configService.get('WEBHOOK_ALLOW_PRIVATE_TARGETS', 'false')) === 'true',
    );
    if (refusal) {
      // Retrying cannot make a refused target acceptable.
      delivery.status = WebhookDeliveryStatus.FAILED;
      delivery.lastError = `target refused: ${refusal}`;
      delivery.lastStatusCode = null;
      delivery.nextAttemptAt = null;
      this.logger.warn(`Webhook ${delivery.id} not sent: ${delivery.lastError}`);
      return this.deliveryRepo.save(delivery);
    }

    const body = JSON.stringify(delivery.payload);
    const secret = this.configService.get<string>('WEBHOOK_SIGNING_SECRET', 'dev-webhook-secret-change-me');
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'prom-verification-network-webhooks',
      'x-prom-event': delivery.event,
      'x-prom-delivery': delivery.id,
      [SIGNATURE_HEADER]: signPayload(secret, Math.floor(now.getTime() / 1000), body),
    };

    let failure: string | null = null;
    try {
      const response = await this.httpClient.post(
        delivery.url,
        body,
        headers,
        Number(this.configService.get('WEBHOOK_TIMEOUT_MS', 5000)),
      );
      delivery.lastStatusCode = response.status;
      if (response.status < 200 || response.status >= 300) {
        failure = `receiver answered ${response.status}`;
      }
    } catch (error) {
      delivery.lastStatusCode = null;
      failure = (error as Error).message;
    }

    if (!failure) {
      delivery.status = WebhookDeliveryStatus.DELIVERED;
      delivery.deliveredAt = now;
      delivery.lastError = null;
      delivery.nextAttemptAt = null;
    } else {
      delivery.lastError = failure;
      const exhausted = delivery.attempts >= maxAttempts;
      // A manual redelivery of an exhausted delivery stays failed if it fails
      // again; it does not put the delivery back on the retry schedule.
      delivery.status = exhausted ? WebhookDeliveryStatus.FAILED : WebhookDeliveryStatus.PENDING;
      delivery.nextAttemptAt = exhausted
        ? null
        : new Date(now.getTime() + backoffMs(delivery.attempts));
      this.logger.warn(
        `Webhook ${delivery.id} attempt ${delivery.attempts}${manual ? ' (manual)' : ''} failed: ${failure}` +
          (exhausted ? '; giving up' : ''),
      );
    }
    return this.deliveryRepo.save(delivery);
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
      }),
    );

    // Started, not awaited: a slow receiver must not hold up the verdict.
    void this.attempt(delivery).catch((error: Error) =>
      this.logger.error(`Webhook ${delivery.id} could not be recorded: ${error.message}`),
    );
    return delivery;
  }
}
