import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum WebhookEvent {
  VERDICT_PUBLISHED = 'verdict.published',
  JOB_FAILED = 'job.failed',
}

export enum WebhookDeliveryStatus {
  /** Not delivered yet; retried at nextAttemptAt. */
  PENDING = 'pending',
  DELIVERED = 'delivered',
  /**
   * Not retried any more (attempts used up, expired, rejected by the
   * receiver); waits in the dead-letter queue to be replayed or left alone.
   */
  DEAD_LETTER = 'dead_letter',
}

/** One notification owed to a job submitter, with its delivery history. */
@Entity('webhook_deliveries')
@Index('IDX_webhook_deliveries_due', ['status', 'nextAttemptAt'])
@Index('IDX_webhook_deliveries_dead_letter', ['deadLetteredAt'], {
  where: `"status" = 'dead_letter'`,
})
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_webhook_deliveries_jobId')
  @Column({ type: 'varchar' })
  jobId!: string;

  @Column({ type: 'varchar' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 1024 })
  url!: string;

  @Column({ type: 'varchar', length: 32 })
  event!: WebhookEvent;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16, default: WebhookDeliveryStatus.PENDING })
  status!: WebhookDeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'int', nullable: true })
  lastStatusCode!: number | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  nextAttemptAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deadLetteredAt!: Date | null;

  /** A DeadLetterReason while dead-lettered. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  deadLetterReason!: string | null;

  /** Last replay out of the dead-letter queue; the maximum age counts from it. */
  @Column({ type: 'timestamp', nullable: true })
  replayedAt!: Date | null;

  /** How often the delivery was taken out of the dead-letter queue again. */
  @Column({ type: 'int', default: 0 })
  replays!: number;
}
